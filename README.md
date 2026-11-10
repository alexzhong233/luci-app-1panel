# luci-app-1panel

在 OpenWrt 上装 [1Panel](https://1panel.cn) v2 的 LuCI 页面，**两套方案二选一**：

| | 容器版 | 本地版 |
|---|---|---|
| 怎么跑 | `docker compose` 起 `moelin/1panel` 镜像 | 官方 `install.sh` 铺二进制，procd 托管 |
| 占 overlay | 只占 compose 文件（1KB） | 两个二进制约 **152MB** |
| 依赖 | docker | bash |
| 数据 | 宿主机 `/mnt` 下，容器里同路径 | 宿主机 `/mnt` 下 |

两套会抢同一个端口和数据目录，所以**互斥**：装了一套，另一套的安装表单会变灰并提示先卸载；
`1panel-ctl` 里也是硬拦（返回 4），不是只在页面上做个样子。

## 页面

- **顶部状态**：一个不会点的彩色按钮，直接写清「1Panel 正在运行（容器版）」还是「（本地版）」，
  旁边跟着版本、访问地址（带入口路径）、`打开面板`
- **容器安装**（默认栏）：端口 / 账号 / 密码 / 入口 / 数据目录（可从检测到的磁盘里挑）/
  镜像 tag / **挂载 root 路径**（把宿主机 `/` 挂到容器 `/ahost`）
- **本地安装**：端口 / 账号 / 密码 / 入口 / 数据目录
- 已装的那一栏变成操作区：更新 / 启动 / 停止 / 重启 / 检查更新 / 日志 / 卸载 / 卸载并删数据
- 安装和更新都在后台跑，页面每 8 秒轮询进度，不会因为拉 175MB 镜像而超时

## 装了什么

| 路径 | 作用 |
|---|---|
| `/usr/libexec/1panel-ctl` | 全部动作，见下 |
| `/etc/config/1panel` | 两套各自的端口、账号、数据目录、镜像、rootpath |
| `$DATADIR/docker-compose.yml` | 容器版生成的 compose（0600，里面有首次初始化的密码） |
| LuCI 页面 | **NAS → 1Panel** |

## 命令

```sh
1panel-ctl status                  # 两套后端的完整状态（页面用的就是这个）
1panel-ctl latest                  # 查远端最新版本
1panel-ctl disks                   # /mnt 下的数据目录候选

# 容器版
1panel-ctl container install <端口> <账号> <密码> <入口> <数据目录> <rootpath 0|1> [镜像]
1panel-ctl container update|start|stop|restart
1panel-ctl container remove [purge]
1panel-ctl container logs

# 本地版
1panel-ctl install <端口> <账号> <密码> <入口> <数据目录>
1panel-ctl update|start|stop|restart
1panel-ctl remove [purge]
1panel-ctl logs
```

## 几个实现上的事实

- **账号 / 密码 / 入口只在首次初始化生效**。容器版靠镜像的 `entrypoint.sh` 把
  `BASE_DIR / PORT / ENTRANCE / USERNAME / PASSWORD` 写进面板数据库，写完打一个
  `.docker_initialized` 标记；本地版靠 `install.sh` 把这些值写进 `/usr/local/bin/1pctl`，
  `1panel-core` 首次建库时从那里读。**只要 `$DATADIR/1panel/db/core.db` 已经存在，
  新填的值就不会生效**（本地版走 `USE_EXISTING`，容器版跳过初始化），页面会提前警告。
  想换账号：卸载时勾「删除数据」，或者手动删掉 `1panel/db/core.db`。
- **端口和入口以面板数据库为准**：页面上的端口/入口是从 `1pctl user-info` 里解析出来的，
  不是从表单或者 uci 里读的，所以重装后也不会显示成你以为的值。
- **版本号不认标签**：`1pctl version` 输出的是带 i18n 前缀的一行（`版本: v2.4.2` /
  `version: v2.4.2`），后面还有一行 `模式: stable`，所以只抓形如 `v2.4.2` 的词。
- **容器版用宿主机路径当 `BASE_DIR`**：容器里 `/mnt` 原样挂进去，所以面板里装应用时
  生成的挂载路径在宿主机上也成立——这是它和「随手 `docker run` 一个面板」最大的区别。
- **没有 docker compose 也能装**：ctl 先试 `docker compose`，再试 `docker-compose`，
  都没有就退回等价的 `docker run`。生成的 compose 文件仍然会写，方便你自己看和改。
- **挂载 root 路径**（`/:/ahost`）默认关。要浏览整机文件、或者装需要碰 `/etc` 的应用时才勾。
- **升级不会丢数据**：容器版是重新拉镜像再重建容器，本地版走官方 `1pctl update`
  （先 `BackupBeforeUpgrade` 再换二进制）。
- **刷机不会丢数据**：本地版的程序在 overlay 会没，数据在 `/mnt` 不动，重装即可；
  容器版的 compose 文件也在 `/mnt`，重装就是重新 `up -d`。
- **`install.sh` 在 apk 系统的误判**：它收尾时用 `command -v opkg` 判断 OpenWrt，
  apk 系固件没有 opkg，会以 1 退出——但文件复制与 procd 注册已经完成，所以 ctl
  不看退出码，自己验进程和端口。
- **临时文件放数据盘**：`$DATADIR/.setup`。`/tmp` 是 tmpfs，解包 169MB 会吃光内存。

## 装这个包

```sh
# 编进固件
CONFIG_PACKAGE_luci-app-1panel=y

# 单独编译
git clone https://github.com/alexzhong233/luci-app-1panel package/luci-app-1panel
make package/luci-app-1panel/compile
```

不重刷固件也可以，一条命令把页面铺到路由器上：

```sh
curl -fsSL https://raw.githubusercontent.com/alexzhong233/luci-app-1panel/main/deploy.sh | sh
```

依赖 `luci-base`、`bash`、`curl`；容器版另外要 docker（不在依赖里，路由器上一般已经有了）。

## 前提

- 数据目录必须在 `/mnt` 下（放 overlay 会写满 flash，刷机也会丢）
- 本地版：overlay 至少留 200MB，页面和 ctl 都会拦
- 容器版：docker 数据盘至少留 300MB（镜像约 175MB）

## 许可证

MIT，见 [LICENSE](LICENSE)。1Panel 本身是 FIT2CLOUD 的产品，遵循它自己的许可证。
