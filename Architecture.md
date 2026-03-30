# Web 用 ピンチ・パン対応ライブラリのアーキテクチャ

このライブラリは、iOS、Android などのネイティブアプリで見られるピンチ・パンなどのジェスチャーによる画面操作を web 上で実現するためのコンポーネントを提供します。以下は、ライブラリのアーキテクチャの概要です。

## 規約

本ライブラリでは、すべての変換を transformX、transformY、scale の組で表現します。なお、scale の原点は対象要素のローカル座標とします。

## モジュール構成

本ライブラリは、以下の 3つの主要なモジュールで構成されます。

1. **Interpreter**: ジェスチャーの検出と処理を担当するモジュールです。ユーザーの入力をキャプチャし、ピンチやパンなどのジェスチャーを識別します。
2. **Store**: 対象要素に適用される変換（拡大縮小、移動など）の状態管理を担います。
3. **Renderer**: 対象要素の描画を担当するモジュールです。Store の情報を参照し、実際の DOM 要素に適用します。

## Interpreter モジュール

本モジュールの役割は、TouchEvent や MouseEvent などのユーザー入力を抽象化し、そこから拡大/縮小、移動などの意味を解釈することです。本モジュールは、これらのイベントを入力とするステートマシンを提供します。

Interpreter は、検出されたジェスチャーの情報を **Motion** として提供します。Motion には、期待される変換の種類（拡大縮小、移動など）、変化量（拡大率、移動距離など）が含まれます。Motion は、変換を直前の状態からの相対的な変化量として表現します。ステートマシンの特定の状態遷移は、Motion を生成するトリガーとなります。Motion は、Interpreter に与えられたコールバックを通して外部に通知されます。

主要なインターフェース、関数は以下の通りです。

- **Interpreter**: Interpreter モジュールが提供するステートマシンのインターフェースです。ユーザー入力を受け取り、Motion を生成します。
  シグニチャは次の通りです:
  type Interpreter = (element: Element) => MountedInterpreter;
  type MountedInterpreter = { subscribe: (cb: Callback<Motion>) => UnsubscribeFn, unmount: UnmountFn };
  Interpreter は、呼び出されると addEventListener を呼び出して対象要素のイベントの監視を開始します。UnmountFn が呼び出されると監視を停止します。
- **touchInterpreter**: タッチイベントを処理する interpreter のファクトリ関数です。複数のタッチポイントを追跡し、ピンチやパンなどのジェスチャーを識別します。
- **mouseDragInterpreter**: マウスドラッグイベントを処理する interpreter のファクトリ関数です。マウスの移動を追跡し、パンジェスチャーを識別します。
- **mouseWheelInterpreter**: マウスホイールイベントを処理する interpreter のファクトリ関数です。ホイールの回転を追跡し、拡大縮小ジェスチャーを識別します。

## Store モジュール

Store モジュールは、Interpreter から提供される Motion を入力とし、対象要素の変換を管理する状態機械です。Store は、対象要素に適用されるべき変換を保持します。また、慣性表現のために、直前の状態との差分をもとに算出された変化率も保持します。例えば、ある瞬間の transform が 40 px であるとして、16 ms 後にそれが 50 px になったとします。この時、変化率は 10 px / 16 ms として計算されます。実際には、Store はこの変化率を行列形式で表現します。Store は、対象要素のローカル座標で変換を表現します。

Store は、requestAnimationFrame() によって駆動される定常的な更新ループを持ちます。Store は ループ間で受け取った Motion をキューイングし、それらを次のループで処理します。前回のループからの間に受け取った Motion がない場合、変化率を使用して、慣性表現のための変換を更新します。

Store の更新ループは絶えず回り続け、基本的に止まることはありません。最適化のために、有意な変化がない場合に描画ループを一時停止することも認められますが、これは Store モジュールの実装の詳細とみなすべきであり、他のモジュールがこの挙動に依存してはなりません。

Store は、コールバックを通して状態変化を通知します。

Store のシグニチャは次のとおりです。

type Store = (interpreters: MountedInterpreter[]) => MountedStore;
type MountedStore = { subscribe: Callback<>, unmount: UnmountFn };

## Renderer モジュール

Renderer モジュールは、Store からの変換情報を受け取り、実際の DOM 要素に適用する役割を担います。これには、CSS トランスフォームを使用して要素を拡大縮小したり、移動したりするためのロジックが含まれます。

Renderer モジュールは、対象要素の CSS トランスフォームを更新するために、対象要素への参照を持ちます。対象要素が mutable であることを除き、Renderer はステートレスです。

## モジュール間の依存関係

- Renderer は Store に依存します。Renderer は Store の状態を監視して、対象要素の変換を適用します。
- Store は Interpreter に依存します。Store は Interpreter から提供される Motion を入力とし、状態を更新します。
- Interpreter は Store や Renderer に依存しません。Interpreter は、ユーザー入力を処理し、Motion を生成することに専念します。

## テスト方針

各モジュールは、単体テストを通じて個別にテストされるべきです。Interpreter モジュールは、ユーザー入力から正しい Motion が生成されることを確認するためのテストが必要です。Store モジュールは、Motion を受け取ったときに正しい状態更新が行われることを確認するためのテストが必要です。Renderer モジュールは、Store の状態に基づいて正しい CSS トランスフォームが適用されることを確認するためのテストが必要です。
