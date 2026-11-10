# luci-app-1panel

在 OpenWrt 上安装和管理 [1Panel](https://1panel.cn) **v2 裸机版**的 LuCI 页面。

不需要 Docker，不需要 systemd。1Panel v2 的安装包里自带
`initscript/1panel-core.procd`，官方 `install.sh` 检测到 `/etc/rc.common`
就会用 procd 托管，所以在这台路由器上是原生进程，和容器方案无关。

## 功能

- **安装**：从官方源拉最新版，端口、账号、密码、入口路径、数据目录都能指定
- **检测更新**：对比远端 `.../package/v2/stable/latest`，有新版本时页面上给出按钮
- **状态**：运行中/已停止、PID、端口是否监听、版本、数据占用、数据盘与 overlay 剩余
- **操作**：启动 / 停止 / 重启 / 更新 / 查看日志 / 打开面板 / 卸载（可选删数据）

安装和更新都在后台跑，页面轮询进度，不会因为下载 59 MB 而超时。

## 装了什么

| 路径 | 作用 |
|---|---|
| `/usr/libexec/1panel-ctl` | 全部动作：`status` / `latest` / `install` / `update` / `start|stop|restart` / `remove [purge]` / `logs` |
| `/etc/config/1panel` | 端口、账号、数据目录（首次安装时写入） |
| LuCI 页面 | **NAS → 1Panel** |
| 1Panel 本体 | 安装时才写：`/usr/local/bin/1panel-core`、`1panel-agent`、`1pctl` |

1Panel 自己装到 overlay（约 152 MB），数据放在 `--install-dir` 指定的目录，
**必须在 `/mnt` 下**，否则脚本直接拒绝。

## 装这个包

```sh
# 编进固件
CONFIG_PACKAGE_luci-app-1panel=y

# 单独编译
git clone https://github.com/alexzhong233/luci-app-1panel package/luci-app-1panel
make package/luci-app-1panel/compile
```

依赖 `luci-base`、`bash`、`curl`。bash 是硬依赖——官方 `install.sh` 和它装出来的
`1pctl` 都是 bash 脚本，busybox ash 跑不了。

## 用法

页面里点就行，命令行等价：

```sh
1panel-ctl status
1panel-ctl install 10086 1panel '你的密码' '你的入口' /mnt/sda1/Configs/1Panel
1panel-ctl update
1panel-ctl logs
1panel-ctl remove          # 保留数据
1panel-ctl remove purge    # 连数据一起删
```

装完访问 `http://<路由器IP>:<端口>/<入口路径>`。

## 几个实现上的事实

- **升级不会丢数据**：走官方 `1pctl update`，它先 `BackupBeforeUpgrade` 再替换二进制。
- **刷机不会丢数据**：程序在 overlay 会没，数据在 `/mnt` 不动。刷完重跑一次安装，
  安装脚本检测到 `1panel/db/core.db` 会走 `USE_EXISTING`，**账号、密码、入口沿用旧值**
  （表单留空即可）。
- **不需要把 152 MB 放进 sysupgrade 备份**：备份包在内存里打包，塞两个二进制既慢又容易失败，
  而且重装比恢复快、还能拿新版。
- **`install.sh` 在 apk 系统的误判**：它收尾时用 `command -v opkg` 判断 OpenWrt，
  apk 系固件没有 opkg，会以 1 退出——但文件复制与 procd 注册已经完成，所以 ctl
  不看退出码，自己验进程和端口。
- **临时文件放数据盘**：`$DATADIR/.setup`。`/tmp` 是 tmpfs，解包 169 MB 会吃光内存。

## 前提

- 需要 bash 和 curl（包已声明依赖）
- overlay 至少留 200 MB（页面会检查并在不够时拦下）
- 数据目录必须在 `/mnt` 下

## 许可证

MIT，见 [LICENSE](LICENSE)。1Panel 本身是 FIT2CLOUD 的产品，遵循它自己的许可证。
