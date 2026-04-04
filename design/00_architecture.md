# Web 用 ピンチ・パン対応ライブラリのアーキテクチャ

## 規約

本ライブラリでは、すべての変換を transformX、transformY、scale の組で表現します。scale の transform-origin は対象要素の左上隅に設定します。ピンチジェスチャーの中心点を基準にスケールしているように見せるために、ピンチの中心点に応じた適切な transformX および transformY の値を計算します（実際のスケール変換は左上隅を基準に適用されます）。

本ライブラリでは状態遷移ロジックを reducer として記述します。

## 共通型定義

```typescript
type UnsubscribeFn = () => void;
type UnmountFn = () => void;
type Callback<T> = (value: T) => void;
```

**Motion** は Interpreter が出力する、直前の状態からの相対変化量です。pan の場合は `dScale: 1`、`originX/Y: 0` とします。

```typescript
type Motion = {
  dx: number;      // 水平移動量 (px)
  dy: number;      // 垂直移動量 (px)
  dScale: number;  // スケール乗算係数（1.0 = 変化なし、1.1 = 10% 拡大）
  originX: number; // スケール原点 X（要素左上からの相対座標 px）
  originY: number; // スケール原点 Y（要素左上からの相対座標 px）
};
```

**State** は Store が出力する、対象要素に適用される変換の現在値です。速度情報は Store の内部状態として隠蔽します。

```typescript
type State = {
  transformX: number; // 水平移動量 (px)
  transformY: number; // 垂直移動量 (px)
  scale: number;      // スケール係数（1.0 = 等倍）
};
```

## モジュール構成

本ライブラリは、以下の 3つの主要なモジュールで構成されます。

1. **Interpreter**: ジェスチャーの検出と処理を担当するモジュールです。ユーザーの入力をキャプチャし、ピンチやパンなどのジェスチャーを識別します。
2. **Store**: 対象要素に適用される変換（拡大縮小、移動など）の状態管理を担います。
3. **Renderer**: 対象要素の描画を担当するモジュールです。Store の情報を参照し、実際の DOM 要素に適用します。

## Interpreter モジュール

本モジュールの役割は、TouchEvent や MouseEvent などのユーザー入力を抽象化し、そこから拡大/縮小、移動などの意味を解釈することです。本モジュールは、これらのイベントを入力とするステートマシンを提供します。

Interpreter は、検出されたジェスチャーの情報を **Motion** として提供します。Motion は、変換を直前の状態からの相対的な変化量として表現します。ステートマシンの特定の状態遷移は、Motion を生成するトリガーとなります。Motion は、Interpreter に与えられたコールバックを通して外部に通知されます。

主要なインターフェース、関数は以下の通りです。

```typescript
type Interpreter = (element: Element) => MountedInterpreter;
type MountedInterpreter = {
  subscribe: (cb: Callback<Motion>) => UnsubscribeFn;
  unmount: UnmountFn;
};

declare function touchInterpreter(): Interpreter;
declare function mouseDragInterpreter(): Interpreter;
declare function mouseWheelInterpreter(): Interpreter;
```

実装の詳細

- Interpreter は、呼び出されると addEventListener を呼び出して対象要素のイベントの監視を開始します。UnmountFn が呼び出されると監視を停止します。
- **touchInterpreter**: タッチイベントを処理する interpreter のファクトリ関数です。複数のタッチポイントを追跡し、ピンチやパンなどのジェスチャーを識別します。
- **mouseDragInterpreter**: マウスドラッグイベントを処理する interpreter のファクトリ関数です。マウスの移動を追跡し、パンジェスチャーを識別します。
- **mouseWheelInterpreter**: マウスホイールイベントを処理する interpreter のファクトリ関数です。ホイールの回転を追跡し、拡大縮小ジェスチャーを識別します。

## Store モジュール

Store モジュールは、Interpreter から提供される Motion を入力とし、対象要素の変換を管理する状態機械です。Store は、対象要素に適用されるべき変換を保持します。また、慣性表現のために、直前の状態との差分をもとに算出された変化率も保持します。例えば、ある瞬間の transform が 40 px であるとして、16 ms 後にそれが 50 px になったとします。この時、変化率は 10 px / 16 ms として計算されます。

Store は、requestAnimationFrame() によって駆動される定常的な更新ループを持ちます。Store は ループ間で受け取った Motion をキューイングし、それらを次のループで処理します。前回のループからの間に受け取った Motion がない場合、変化率を指数関数的に減衰させながら慣性表現のための変換を更新します。

Store の更新ループは絶えず回り続け、基本的に止まることはありません。最適化のために、有意な変化がない場合に描画ループを一時停止することも認められますが、これは Store モジュールの実装の詳細とみなすべきであり、他のモジュールがこの挙動に依存してはなりません。

Store は、コールバックを通して状態変化を通知します。

```typescript
type Store = (interpreters: MountedInterpreter[]) => MountedStore;
type MountedStore = {
  subscribe: (cb: Callback<State>) => UnsubscribeFn;
  unmount: UnmountFn;
};

declare function createStore(): Store;
```

Store に渡す `MountedInterpreter[]` の生成（Interpreter の mount）は、ユーザーの責任とします。

実装の詳細

- Store の状態遷移は reducer として記述されます。Store の root reducer は、transform と scale の変化率のトラッキングを sub reducer ValuePrimitive に委譲します。ValuePrimitive には transform のための LinearPrimitive と、scale のための ExponentialPrimitive があります。LinearPrimitive は移動量を線形に扱います。これはドラッグ操作などのユーザー入力と移動量の関係が線形であるためです。ExponentialPrimitive は scale を指数関数的に扱います。これは scale が乗算的な性質を持ち、指数関数的な表現のほうがズームイン・ズームアウト時に自然な操作感を提供できるためです。
- 速度情報（velocityX、velocityY、scaleVelocity）は Store の内部状態として保持し、State には含めません。

## Renderer モジュール

Renderer モジュールは、Store からの変換情報を受け取り、実際の DOM 要素に適用する役割を担います。これには、CSS トランスフォームを使用して要素を拡大縮小したり、移動したりするためのロジックが含まれます。

Renderer は Store を subscribe し、State が更新されるたびに対象要素の CSS トランスフォームを更新します。Renderer は内部状態を持たず、副作用（DOM の更新）のみを担います。

```typescript
type Renderer = (element: Element, store: MountedStore) => MountedRenderer;
type MountedRenderer = {
  unmount: UnmountFn;
};

declare function createRenderer(): Renderer;
```

## モジュール間の依存関係

- Renderer は Store に依存します。Renderer は Store の状態を監視して、対象要素の変換を適用します。
- Store は Interpreter に依存します。Store は Interpreter から提供される Motion を入力とし、状態を更新します。
- Interpreter は Store や Renderer に依存しません。Interpreter は、ユーザー入力を処理し、Motion を生成することに専念します。

## テスト方針

各モジュールは、単体テストを通じて個別にテストされるべきです。Interpreter モジュールは、ユーザー入力から正しい Motion が生成されることを確認するためのテストが必要です。Store モジュールは、Motion を受け取ったときに正しい状態更新が行われることを確認するためのテストが必要です。Renderer モジュールは、Store の状態に基づいて正しい CSS トランスフォームが適用されることを確認するためのテストが必要です。
