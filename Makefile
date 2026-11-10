include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-1panel
PKG_VERSION:=1.1
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=Alex Zhong <alexzhong233@users.noreply.github.com>

LUCI_TITLE:=1Panel v2 裸机安装与状态
LUCI_DESCRIPTION:=从官方源安装 1Panel v2、检测更新、启停与状态查看。OpenWrt \
上由 procd 托管 1panel-core 与 1panel-agent，不依赖容器。
LUCI_PKGARCH:=all
# bash 是硬依赖：官方 install.sh 与它装出来的 1pctl 都是 bash 脚本。
LUCI_DEPENDS:=+luci-base +bash +curl

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
