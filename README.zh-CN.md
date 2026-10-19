# gc-redeem

[English](README.md) | 中文

一个 Tampermonkey 用户脚本，自动兑换 Gmail 中的 gift-card 链接
（giftcards.com → Visa 虚拟账户注册），并将发放的卡号收集导出为 TSV 文件。

> 与 giftcards.com 无任何关联。使用风险自负。

## 快速开始

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome/Edge 还需开启
   "Allow User Scripts" —— 见下方"安装"）。
2. **[安装脚本（最新版本）](https://github.com/bviypz/gc-redeem/releases/latest/download/gc-redeem.user.js)** → 在 Tampermonkey 安装页点击 **Install**。
3. 打开包含 "Redeem now" 链接的 Gmail 邮件 → Tampermonkey 菜单 →
   **GC: Settings**，填写一次个人资料。
4. Tampermonkey 菜单 → **GC: Redeem all gift cards**。每个 reCAPTCHA 需手动
   完成；卡号会自动保存。
5. 完成后 Tampermonkey 菜单 → **GC: Download card data (TSV)**。

## 工作原理

1. 打开包含 "Redeem now" 链接的 Gmail 邮件。
2. Tampermonkey 菜单 → **GC: Settings** —— 填写一次注册资料（姓名、地址、
   邮箱……）。仅保存在本机浏览器的 Tampermonkey 中。
3. Tampermonkey 菜单 → **GC: Redeem all gift cards** —— 打开所有兑换链接，
   在每个页面填写邮箱和注册表单，停在 reCAPTCHA 处。**你**在每个标签页手动
   完成验证：勾选 **I'm not a robot**，然后点击 **Submit**：

   ![reCAPTCHA 勾选框和 Submit 按钮](docs/recaptcha-submit.png)

   提交后脚本会自动检测发放的卡片并保存卡号。
4. 每张发放的卡号都会自动保存。Tampermonkey 菜单 →
   **GC: View collected cards** 查看，或 **GC: Download card data (TSV)**
   导出（字段：`order_number, card_number, valid_thru, cvv, redeemed_at,
   collected_at, status`）。

已兑换过的卡会被直接处理：claim 会直接跳到卡片详情页并直接抓取。兑换成功
后，giftcards.com 标签页会在订单号交接完成后自动关闭（debug 模式下不会
自动关闭）。

## 安装（首次）

1. 安装 **Tampermonkey** 浏览器扩展：
   [Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) ·
   [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaejbjikekkigoigdjldjjbkj) ·
   [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)。
2. **仅 Chrome/Edge —— 开启 "Allow User Scripts"。** Chrome 默认禁止扩展运行
   用户脚本，需要手动开启：打开 `chrome://extensions`（Edge 为
   `edge://extensions`），找到 **Tampermonkey** → **Details**，开启
   **Allow User Scripts**。不开的话，脚本能安装但不会运行（Tampermonkey
   菜单里标题显示为灰色）。

   ![Allow User Scripts 开关](docs/allow-user-scripts.png)

   > The extension will be able to run code which has not been reviewed by
   > Google. It may be unsafe and you should only enable this if you know
   > what you are doing.
   >
   > （该扩展将可以运行未经 Google 审核的代码，可能不安全，仅在你清楚自己
   > 在做什么时开启。）
3. 点击安装链接（永远是最新版本）：
   [gc-redeem.user.js](https://github.com/bviypz/gc-redeem/releases/latest/download/gc-redeem.user.js)
4. Tampermonkey 会打开安装页 —— 点击 **Install**。
5. 打开包含兑换链接的 Gmail 邮件，然后打开 Tampermonkey 菜单（拼图图标 →
   Tampermonkey），选择 **GC: Settings** 填写一次注册资料。

## 隐私

全部在本地浏览器运行。脚本**不会**向任何第三方服务器发请求 —— 只操作你
本来就会访问的 giftcards.com 页面。个人资料和收集的卡数据保存在本机
Tampermonkey 存储中。如不放心，可用 DevTools → Network 自行验证。

## 更新

Tampermonkey 会按你设置的更新间隔自动检查更新。本仓库发布新版本后，
Tampermonkey 会提示你更新，可在 dashboard 中安装。

## 维护者：发布新版本

1. 在 `gc-redeem.user.js` 中 bump `// @version`（Tampermonkey 只认*更高*
   的版本号）。
2. 提交并推送，然后打 tag 并推送 tag：
   `git tag vX.Y.Z && git push origin vX.Y.Z`
3. `Create release` workflow 会自动为该 tag 创建 GitHub Release，并附上
   `gc-redeem.user.js` 和 `gc-redeem.meta.js` —— Tampermonkey 轮询更新靠的
   就是它。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
