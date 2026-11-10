include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-1panel
PKG_VERSION:=1.2
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=Alex Zhong <alexzhong233@users.noreply.github.com>

LUCI_TITLE:=1Panel v2 容器版 / 本地版安装与状态
LUCI_DESCRIPTION:=两条路二选一装 1Panel v2：容器版用 docker compose 跑官方镜像，\
本地版由 procd 托管裸二进制。含版本检测、启停、卸载与状态查看。
LUCI_PKGARCH:=all
# bash 是本地版的硬依赖：官方 install.sh 与它装出来的 1pctl 都是 bash 脚本。
# 容器版只要 docker，不装这个包也能用（docker 不在依赖里，路由器上本来就有）。
LUCI_DEPENDS:=+luci-base +bash +curl

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
