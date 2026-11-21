# 開発ルール
以下のルールを厳守

## Frontend
* フロントエンドは普通のTanStack Start
* React v19以降の書き方を推奨
* useEffectは必要な場面しか使わない
* API通信やキャッシュはTanStack Query
* pnpmをパッケージ管理マネージャに指定
* toCなので
* layoutは普通のCSSで作る。ユーティリティクラスに意味のある名前を持たせる
* コンポーネントを容易に作りたいのでMantineを今回は採用したい

## Backend
* Honoを使用
* pnpmをパッケージ管理マネージャに指定
* BetterAuthを認証機能に使用。メールアドレス・パスワードログイン
* ORM: drizzle .forが行ロックで使えるので使用
* PostgreSQL v17をDockerで構築する