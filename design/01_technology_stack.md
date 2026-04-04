# Technology Stack

このプロジェクトは、モノレポ構成でライブラリとデモプロジェクトを管理します。

## パッケージ構成

| パッケージ | 役割 |
|-----------|------|
| `@mimosa/core` | ライブラリ本体 |
| `@mimosa/demo` | 動作確認用デモアプリケーション |

## ディレクトリ構造

```
packages/
  core/                  # @mimosa/core
    src/
      interpreter/
        touch.ts
        mouse-drag.ts
        mouse-wheel.ts
        index.ts
      store/
        primitives.ts    # LinearPrimitive, ExponentialPrimitive
        index.ts
      renderer/
        index.ts
      types.ts           # Motion, State, 共通プリミティブ型
    package.json
    tsconfig.json
  demo/                  # @mimosa/demo
    src/
    package.json
    tsconfig.json
package.json             # ワークスペースルート
```

## 使用技術

- 共通
  - TypeScript
  - Vite
- `@mimosa/core`
  - Vitest
- `@mimosa/demo`
  - React
  - Tailwind CSS
  - デモプロジェクトは UI 中心であり、自動テストは行いません。
