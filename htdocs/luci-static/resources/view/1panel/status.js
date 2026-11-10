'use strict';
'require view';
'require fs';
'require ui';
'require poll';

var TOOL = '/usr/libexec/1panel-ctl';

function call(args) {
	return fs.exec(TOOL, args).then(function(res) {
		var text = ((res && res.stdout) || '') + ((res && res.stderr) || '');

		return { code: res ? res.code : 1, text: String(text).replace(/\s+$/, '') };
	}).catch(function(err) {
		return { code: 1, text: '执行失败：' + (err && err.message ? err.message : err) };
	});
}

function parseKV(text) {
	var out = {};

	(text || '').split('\n').forEach(function(line) {
		var idx = line.indexOf('=');

		if (idx > 0)
			out[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
	});

	return out;
}

/* disks 一行一个候选：disk=/mnt/sda1:123456 */
function parseDisks(text) {
	return (text || '').split('\n').map(function(line) {
		var m = /^disk=(.+):(\d+)$/.exec(line.trim());

		return m ? { mount: m[1], free: parseInt(m[2], 10) } : null;
	}).filter(function(x) { return x; });
}

function flag(v) {
	return String(v) === '1';
}

function int(v) {
	return parseInt(v, 10) || 0;
}

function vnum(v) {
	return String(v || '').replace(/^v/, '');
}

function mb(kb) {
	var n = int(kb);

	return n >= 1048576 ? (n / 1048576).toFixed(1) + ' GB' : Math.round(n / 1024) + ' MB';
}

function badge(ok, okText, badText) {
	return E('span', { 'class': 'label ' + (ok ? 'success' : 'warning') }, [ ok ? okText : badText ]);
}

function muted(text) {
	return E('span', { 'class': 'cbi-value-description' }, [ text ]);
}

function warn(text) {
	return E('span', { 'class': 'p1-warn' }, [ text ]);
}

function link(url, text) {
	if (!url)
		return muted('—');

	return E('a', { 'href': url, 'target': '_blank', 'rel': 'noopener' }, [ text || url ]);
}

/* 任务阶段：pulling:moelin/1panel:v2 / downloading:v2.4.2 / done:... / error:... */
function parseTask(s) {
	var raw = String(s || 'idle');
	var i = raw.indexOf(':');

	return i > 0
		? { phase: raw.substring(0, i), detail: raw.substring(i + 1) }
		: { phase: raw, detail: '' };
}

var PHASE_TEXT = {
	pulling: _('拉取镜像'),
	downloading: _('下载安装包'),
	extracting: _('解包'),
	installing: _('安装文件并注册服务'),
	starting: _('等待服务就绪'),
	updating: _('升级中'),
	done: _('完成'),
	error: _('失败'),
	idle: _('空闲')
};

function busy(phase) {
	return phase === 'pulling' || phase === 'downloading' || phase === 'extracting'
		|| phase === 'installing' || phase === 'starting' || phase === 'updating';
}

/* 表格用 CSS Grid 而不是 <table>：Argon/Aurora 这类主题对 th/td 有高特异性
 * 的 !important 规则，会把表头和数据行拆成不同盒模型导致列错位。两个 grid
 * 共用同一份 template-columns 就不受这些规则影响。 */
var CSS = [
	'.p1-wrap { overflow-x: auto; }',
	'.p1-grid { display: grid; grid-template-columns: 11rem minmax(14rem, 1fr); min-width: 30rem; }',
	'.p1-k { padding: .45rem .6rem; font-weight: bold;',
	'  border-bottom: 1px solid rgba(128,128,128,.18); }',
	'.p1-c { padding: .45rem .6rem; border-bottom: 1px solid rgba(128,128,128,.18); }',
	'.p1-actions .btn { margin-right: .5rem; margin-bottom: .5rem; }',
	'.p1-form { display: grid; grid-template-columns: 11rem minmax(12rem, 26rem);',
	'  gap: .5rem .8rem; align-items: center; }',
	'.p1-form input[type=text], .p1-form input[type=password], .p1-form select {',
	'  width: 100%; box-sizing: border-box; }',
	'.p1-form .p1-hint { grid-column: 1 / -1; margin: 0; }',
	'.p1-tabs { display: flex; flex-wrap: wrap; gap: .4rem; margin: 1.2rem 0 0;',
	'  border-bottom: 1px solid rgba(128,128,128,.3); }',
	'.p1-tab { padding: .5rem 1.1rem; cursor: pointer; border: 1px solid transparent;',
	'  border-bottom: 0; border-radius: .35rem .35rem 0 0; background: transparent;',
	'  color: inherit; font: inherit; margin-bottom: -1px; }',
	'.p1-tab.on { border-color: rgba(128,128,128,.3); background: rgba(128,128,128,.12);',
	'  font-weight: bold; }',
	'.p1-tab .p1-tag { font-size: .8em; opacity: .75; }',
	'.p1-task { margin-top: 1rem; padding: .6rem .8rem; border-left: 3px solid #3b82f6;',
	'  background: rgba(59,130,246,.08); }',
	'.p1-task.err { border-left-color: #dc2626; background: rgba(220,38,38,.08); }',
	'.p1-task.ok { border-left-color: #16a34a; background: rgba(22,163,74,.08); }',
	'.p1-warn { color: #d97706; }',
	'.p1-up { color: #dc2626; font-weight: bold; }',
	'.p1-alert { margin: .8rem 0; padding: .6rem .8rem; border-left: 3px solid #dc2626;',
	'  background: rgba(220,38,38,.09); }',
	'.p1-head { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }'
].join('\n');

var TABS = [
	{ id: 'container', title: _('容器安装') },
	{ id: 'native', title: _('本地安装') }
];

return view.extend({
	load: function() {
		return Promise.all([
			call([ 'status' ]),
			call([ 'latest' ]),
			call([ 'disks' ])
		]);
	},

	render: function(results) {
		var self = this;
		var state = {
			tab: 'container',
			st: parseKV(results[0] ? results[0].text : ''),
			latest: parseKV(results[1] ? results[1].text : '').latest || '',
			disks: parseDisks(results[2] ? results[2].text : ''),
			sig: ''
		};

		var out = E('pre', {
			'id': 'p1-out',
			'style': 'max-height:18rem;overflow:auto;white-space:pre-wrap;word-break:break-all;margin:1rem 0 0'
		}, [ _('（还没有执行任何操作）') ]);

		var headWrap = E('div');
		var tabWrap = E('div', { 'class': 'p1-tabs' });
		var paneWrap = E('div');

		function setOut(text) {
			out.textContent = text || _('（无输出）');
		}

		function run(args, label) {
			setOut(_('正在执行：') + label + ' ...');

			return call(args).then(function(res) {
				setOut('$ 1panel-ctl ' + args.join(' ') + '\n\n' + (res.text || _('（无输出）')));

				return refresh(true).then(function(fresh) {
					/* 安装/卸载这类动作会把表单和按钮互换，强制重画。 */
					if (flag(fresh.container_present) !== flag(state.st.container_present) ||
					    flag(fresh.native_present) !== flag(state.st.native_present))
						state.sig = '';

					return fresh;
				});
			});
		}

		function button(label, args, opts) {
			opts = opts || {};

			return E('button', {
				'class': 'btn cbi-button' + (opts.primary ? ' cbi-button-apply' : '') +
					(opts.danger ? ' cbi-button-reset' : ''),
				'disabled': opts.disabled ? 'disabled' : null,
				'click': function(ev) {
					ev.preventDefault();

					if (opts.confirm && !window.confirm(opts.confirm))
						return;

					return run(args, label);
				}
			}, [ label ]);
		}

		function clear(node) {
			while (node.firstChild)
				node.removeChild(node.firstChild);
		}

		/* ---------------- 顶部状态（容器/本地分开说） ---------------- */
		function drawHead(st) {
			var kind = st.kind || 'none';
			var running = flag(st.running) && kind !== 'none';
			var t = parseTask(st.task);
			var label = kind === 'container' ? _('1Panel 正在运行（容器版）')
				: kind === 'native' ? _('1Panel 正在运行（本地版）')
				: _('1Panel 未运行');

			var rows = [];

			function row(k, v) {
				rows.push([
					E('div', { 'class': 'p1-k' }, [ k ]),
					E('div', { 'class': 'p1-c' }, Array.isArray(v) ? v : [ v ])
				]);
			}

			if (flag(st.conflict))
				rows.push(E('div', { 'class': 'p1-alert', 'style': 'grid-column:1 / -1' }, [
					E('strong', {}, [ _('同时装了两套 1Panel') ]),
					E('div', { 'style': 'margin-top:.3rem' }, [
						_('容器版和本地版会抢同一个端口和数据目录。请在下面的标签页里卸载其中一个，再继续用另一个。')
					])
				]));

			var headBtn = E('button', {
				'class': 'btn cbi-button ' + (running ? 'cbi-button-success' : 'cbi-button-negative'),
				'disabled': 'disabled',
				'style': 'cursor:default;min-width:13rem;opacity:1'
			}, [ label ]);

			var openBtn = null;

			if (running && st.address)
				openBtn = E('a', {
					'class': 'btn cbi-button cbi-button-action',
					'href': st.address,
					'target': '_blank',
					'rel': 'noopener'
				}, [ _('打开面板') ]);

			row(_('状态'), E('div', { 'class': 'p1-head' }, [ headBtn, openBtn || '' ]));

			if (kind !== 'none') {
				var verCell = [ E('code', {}, [ st.version || '—' ]) ];
				var newv = state.latest || st.latest || '';

				if (newv && st.version && vnum(newv) !== vnum(st.version))
					verCell.push(E('span', { 'class': 'p1-up', 'style': 'margin-left:.6rem' },
						[ _('有新版本 %s').format(newv) ]));
				else if (newv && st.version)
					verCell.push(muted(' ' + _('（已是最新）')));

				row(_('版本'), verCell);
				row(_('访问地址'), link(st.address));
			}
			else {
				row(_('版本'), muted(_('安装后显示')));
				row(_('访问地址'), muted(_('安装后可用')));
			}

			row(_('运行方式'), kind === 'container'
				? E('span', {}, [ _('容器（docker）'), muted(' '), E('code', {}, [ st.container_image || '—' ]) ])
				: kind === 'native' ? E('span', {}, [ _('本地进程（procd 托管）') ])
				: muted('—'));

			row(_('监听端口'), st.port || '—');
			row(_('登录账号'), st.username || '—');
			row(_('入口路径'), st.entrance ? E('code', {}, [ st.entrance ]) : muted(_('未设置')));
			row(_('数据目录'), [
				E('code', {}, [ st.datadir || '—' ]),
				kind === 'container' && st.container_datadir && st.container_datadir !== st.datadir
					? muted(' ' + st.container_datadir) : ''
			]);
			row(_('数据盘剩余'), mb(st.data_free_kb));
			row(_('overlay 剩余'), mb(st.overlay_free_kb));

			if (flag(st.docker))
				row(_('Docker 剩余'), mb(st.docker_free_kb));

			if (busy(t.phase) || t.phase === 'error' || t.phase === 'done') {
				var cls = 'p1-task' + (t.phase === 'error' ? ' err' : (t.phase === 'done' ? ' ok' : ''));

				rows.push(E('div', { 'class': 'p1-c', 'style': 'grid-column:1 / -1; padding:0; border:0' }, [
					E('div', { 'class': cls }, [
						E('strong', {}, [ PHASE_TEXT[t.phase] || t.phase ]),
						t.detail ? E('span', {}, [ ' ' + t.detail ]) : '',
						t.phase === 'error'
							? E('div', { 'style': 'margin-top:.4rem' }, [
								muted(_('点「查看日志」看输出，日志文件 /var/run/1panel-task/log。'))
							])
							: ''
					])
				]));
			}

			var grid = E('div', { 'class': 'p1-grid' });
			rows.forEach(function(nodes) {
				/* 普通行是 [标签, 值] 两格，冲突提示这种整行元素只有一格。 */
				[].concat(nodes).forEach(function(n) { grid.appendChild(n); });
			});

			clear(headWrap);
			headWrap.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'p1-wrap' }, [ grid ])
			]));
		}

		/* ---------------- 标签栏 ---------------- */
		function drawTabs(st) {
			clear(tabWrap);

			TABS.forEach(function(t) {
				var tag = '';
				var on = state.tab === t.id;

				if (t.id === 'container' && flag(st.container_present))
					tag = _('（已装）');
				if (t.id === 'native' && flag(st.native_present))
					tag = _('（已装）');

				tabWrap.appendChild(E('button', {
					'class': 'p1-tab' + (on ? ' on' : ''),
					'click': function(ev) {
						ev.preventDefault();
						state.tab = t.id;
						state.sig = '';
						drawAll(true);
					}
				}, [ t.title, tag ? E('span', { 'class': 'p1-tag' }, [ ' ' + tag ]) : '' ]));
			});
		}

		/* ---------------- 表单零件 ---------------- */
		function field(label, value, type, placeholder) {
			var input = E('input', {
				'type': type || 'text',
				'class': 'cbi-input-text',
				'placeholder': placeholder || '',
				'value': value || ''
			});

			return { input: input, nodes: [ E('label', {}, [ label ]), input ] };
		}

		function dirField(st, value) {
			var input = E('input', {
				'type': 'text',
				'class': 'cbi-input-text',
				'value': value || ''
			});

			var opts = state.disks.map(function(d) {
				/* <option> 里只能放纯文本，套元素不显示。 */
				return E('option', { 'value': d.mount + '/Configs/1Panel' },
					[ d.mount + '/Configs/1Panel  (' + _('剩余 %s').format(mb(d.free)) + ')' ]);
			});

			var sel = E('select', {
				'class': 'cbi-input-select',
				'change': function(ev) { input.value = ev.target.value; }
			}, [ E('option', { 'value': '' }, [ _('从检测到的磁盘里选…') ]) ].concat(opts));

			return {
				input: input,
				nodes: [
					E('label', {}, [ _('数据目录') ]),
					E('div', {}, [
						E('div', { 'style': 'margin-bottom:.35rem' }, [ sel ]),
						input,
						muted(' ' + _('必须在 /mnt 下；面板的数据库、备份、应用都写这里'))
					])
				]
			};
		}

		function passField() {
			return field(_('登录密码'), '', 'password', _('至少 8 位'));
		}

		function taskBox(st) {
			var t = parseTask(st.task);

			if (!busy(t.phase) && t.phase !== 'error' && t.phase !== 'done')
				return null;

			var cls = 'p1-task' + (t.phase === 'error' ? ' err' : (t.phase === 'done' ? ' ok' : ''));

			return E('div', { 'class': cls, 'style': 'margin-top:1rem' }, [
				E('strong', {}, [ PHASE_TEXT[t.phase] || t.phase ]),
				t.detail ? E('span', {}, [ ' ' + t.detail ]) : ''
			]);
		}

		function blocked(which, st) {
			var other = which === 'container' ? flag(st.native_present) : flag(st.container_present);

			if (!other)
				return null;

			return E('div', { 'class': 'p1-alert' }, [
				E('strong', {}, [ which === 'container'
					? _('已安装本地版 1Panel，不能再装容器版')
					: _('已安装容器版 1Panel，不能再装本地版') ]),
				E('div', { 'style': 'margin-top:.3rem' }, [
					_('两套会抢同一个端口和数据目录。请先到「%s」标签页里卸载它，再回到这里安装。')
						.format(which === 'container' ? _('本地安装') : _('容器安装'))
				])
			]);
		}

		/* ---------------- 容器版 ---------------- */
		function containerPane(st) {
			var inFlight = busy(parseTask(st.task).phase);
			var blk = blocked('container', st);

			if (flag(st.container_present)) {
				var running = flag(st.container_running);
				var cur = st.container_version || '';
				var newv = state.latest || st.latest || '';
				var canUpdate = newv && cur && vnum(newv) !== vnum(cur);
				var ops = [];

				if (canUpdate)
					ops.push(button(_('更新到 %s').format(newv), [ 'container', 'update' ],
						{ primary: true, disabled: inFlight }));

				ops.push(running
					? button(_('停止'), [ 'container', 'stop' ], { disabled: inFlight })
					: button(_('启动'), [ 'container', 'start' ], { primary: true, disabled: inFlight }));
				ops.push(button(_('重启'), [ 'container', 'restart' ], { disabled: inFlight }));
				ops.push(button(_('检查更新'), [ 'latest' ]));
				ops.push(button(_('查看日志'), [ 'container', 'logs' ]));

				if (running && st.address)
					ops.push(E('a', {
						'class': 'btn cbi-button cbi-button-action',
						'href': st.address,
						'target': '_blank',
						'rel': 'noopener',
						'style': 'margin-right:.5rem;margin-bottom:.5rem'
					}, [ _('打开面板') ]));

				ops.push(button(_('卸载容器'), [ 'container', 'remove' ], {
					danger: true,
					disabled: inFlight,
					confirm: _('会停掉并删除 1panel 容器，数据目录保留。继续？')
				}));

				ops.push(button(_('卸载并删除数据'), [ 'container', 'remove', 'purge' ], {
					danger: true,
					disabled: inFlight,
					confirm: _('会删掉容器和 %s/1panel 里的数据库、备份、应用，不可恢复。继续？')
						.format(st.container_datadir || '')
				}));

				return E('div', { 'class': 'cbi-section p1-actions' }, [
					E('h3', {}, [ _('容器版 1Panel') ]),
					E('div', { 'class': 'cbi-map-descr' }, [
						_('用 docker compose 跑的 1Panel v2。数据在宿主机 /mnt 下，容器里的路径和宿主机一致，'),
						_('所以面板里装的应用挂载出来的路径是对的。'),
						E('br'),
						_('升级就是重新拉镜像再重建容器，账号和入口只在首次初始化时写入，'),
						_('已有数据库会沿用旧值——想换账号得先删数据。')
					]),
					E('div', { 'style': 'margin-top:1rem' }, [
						E('div', {}, [ _('镜像'), ': ', E('code', {}, [ st.container_image || '—' ]) ]),
						E('div', {}, [ _('数据目录'), ': ', E('code', {}, [ st.container_datadir || '—' ]) ]),
						E('div', {}, [ _('挂载 root 路径'), ': ',
							flag(st.container_rootpath) ? _('已开启（/ahost）') : _('未开启') ])
					]),
					E('div', { 'style': 'margin-top:1rem' }, ops),
					taskBox(st)
				]);
			}

			/* 未安装：安装表单 */
			var fPort = field(_('监听端口'), st.container_port || '10086');
			var fUser = field(_('登录账号'), st.container_username || '1panel');
			var fPass = passField();
			var fEnt = field(_('入口路径'), '', 'text', _('例如 panel-8x3k，别用 entrance'));
			var fDir = dirField(st, st.container_datadir || '/mnt/sda1/Configs/1Panel');
			var fImg = field(_('镜像'), st.container_image || 'moelin/1panel:v2');

			var chkRoot = E('input', { 'type': 'checkbox' });
			var rootRow = [
				E('label', {}, [ _('挂载 root 路径') ]),
				E('div', {}, [
					E('label', {}, [ chkRoot, ' ', _('把宿主机根目录挂到容器的 /ahost') ]),
					E('div', {}, [ muted(_('面板里要浏览整机文件、或者装需要碰 /etc 的应用时才勾。')) ])
				])
			];

			var installBtn = E('button', {
				'class': 'btn cbi-button cbi-button-apply',
				'disabled': (inFlight || blk) ? 'disabled' : null
			}, [ inFlight ? _('安装进行中…') : _('开始安装（容器版）') ]);

			installBtn.addEventListener('click', function(ev) {
				ev.preventDefault();

				if (!fPass.input.value || fPass.input.value.length < 8) {
					ui.addNotification(null, E('p', {}, [ _('密码至少 8 位') ]), 'warning');
					return;
				}

				if (!/^[A-Za-z0-9._-]+$/.test(fEnt.input.value)) {
					ui.addNotification(null, E('p', {}, [
						_('入口路径只能用字母、数字、点、下划线和连字符')
					]), 'warning');
					return;
				}

				if (fDir.input.value.indexOf('/mnt/') !== 0) {
					ui.addNotification(null, E('p', {}, [
						_('数据目录必须在 /mnt 下：面板的数据、备份、应用都写这里')
					]), 'warning');
					return;
				}

				installBtn.disabled = true;
				installBtn.textContent = _('安装进行中…');

				return run([ 'container', 'install', fPort.input.value, fUser.input.value,
					fPass.input.value, fEnt.input.value, fDir.input.value,
					chkRoot.checked ? '1' : '0', fImg.input.value ], _('安装容器版'));
			});

			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('安装容器版 1Panel') ]),
				E('div', { 'class': 'cbi-map-descr' }, [
					_('从 Docker Hub 拉官方镜像（moelin/1panel），用 docker compose 起容器。'),
					E('br'),
					_('端口、账号、密码、入口都由容器环境变量在首次初始化时写进面板，'),
					_('数据目录选 /mnt 下的路径，容器里看到的是同一个路径，面板装应用时挂载才对。')
				]),
				blk || '',
				flag(st.docker) ? '' : E('div', { 'class': 'p1-alert' }, [
					_('Docker 没在运行，容器版装不了。先确认 docker 服务和 /var/run/docker.sock 正常。')
				]),
				flag(st.container_datakept)
					? E('div', { 'class': 'p1-warn', 'style': 'margin:.6rem 0' }, [
						_('检测到 %s 里已有面板数据：账号、入口会沿用旧值，想换新值要先删数据目录。')
							.format(st.container_datadir || '')
					])
					: '',
				E('div', { 'class': 'p1-form', 'style': 'margin-top:1rem' },
					[].concat(fPort.nodes, fUser.nodes, fPass.nodes, fEnt.nodes,
						fDir.nodes, fImg.nodes, rootRow)),
				E('div', { 'style': 'margin-top:1rem' }, [ installBtn ]),
				taskBox(st)
			]);
		}

		/* ---------------- 本地版 ---------------- */
		function nativePane(st) {
			var inFlight = busy(parseTask(st.task).phase);
			var blk = blocked('native', st);

			if (flag(st.native_present)) {
				var running = flag(st.native_running);
				var cur = st.native_version || '';
				var newv = state.latest || st.latest || '';
				var canUpdate = newv && cur && vnum(newv) !== vnum(cur);
				var ops = [];

				if (canUpdate)
					ops.push(button(_('更新到 %s').format(newv), [ 'update' ],
						{ primary: true, disabled: inFlight }));

				ops.push(running
					? button(_('停止'), [ 'stop' ], { disabled: inFlight })
					: button(_('启动'), [ 'start' ], { primary: true, disabled: inFlight }));
				ops.push(button(_('重启'), [ 'restart' ], { disabled: inFlight }));
				ops.push(button(_('检查更新'), [ 'latest' ]));
				ops.push(button(_('查看日志'), [ 'logs' ]));

				if (running && st.address)
					ops.push(E('a', {
						'class': 'btn cbi-button cbi-button-action',
						'href': st.address,
						'target': '_blank',
						'rel': 'noopener',
						'style': 'margin-right:.5rem;margin-bottom:.5rem'
					}, [ _('打开面板') ]));

				ops.push(button(_('卸载'), [ 'remove' ], {
					danger: true,
					disabled: inFlight,
					confirm: _('卸载会删掉程序和 procd 服务，数据目录保留。继续？')
				}));

				ops.push(button(_('卸载并删除数据'), [ 'remove', 'purge' ], {
					danger: true,
					disabled: inFlight,
					confirm: _('这会连同 %s 里的数据库、日志、备份一起删掉，不可恢复。继续？')
						.format(st.native_datadir || '')
				}));

				return E('div', { 'class': 'cbi-section p1-actions' }, [
					E('h3', {}, [ _('本地版 1Panel') ]),
					E('div', { 'class': 'cbi-map-descr' }, [
						_('官方 install.sh 铺二进制，procd 托管 1panel-core 与 1panel-agent，不走容器。'),
						E('br'),
						_('两个二进制约 152MB 落在 overlay；升级走 1pctl update，只换二进制。')
					]),
					E('div', { 'style': 'margin-top:1rem' }, ops),
					taskBox(st)
				]);
			}

			var fPort = field(_('监听端口'), st.native_port || '10086');
			var fUser = field(_('登录账号'), st.native_username || '1panel');
			var fPass = passField();
			var fEnt = field(_('入口路径'), '', 'text', _('例如 panel-8x3k，别用 entrance'));
			var fDir = dirField(st, st.native_datadir || '/mnt/sda1/Configs/1Panel');
			var kept = flag(st.native_datakept);

			var installBtn = E('button', {
				'class': 'btn cbi-button cbi-button-apply',
				'disabled': (inFlight || blk) ? 'disabled' : null
			}, [ inFlight ? _('安装进行中…') : _('开始安装（本地版）') ]);

			installBtn.addEventListener('click', function(ev) {
				ev.preventDefault();

				if (!kept && (!fPass.input.value || fPass.input.value.length < 8)) {
					ui.addNotification(null, E('p', {}, [ _('密码至少 8 位') ]), 'warning');
					return;
				}

				if (!kept && !fEnt.input.value) {
					ui.addNotification(null, E('p', {}, [
						_('入口路径不能为空，随便起一个不容易猜的名字')
					]), 'warning');
					return;
				}

				if (fDir.input.value.indexOf('/mnt/') !== 0) {
					ui.addNotification(null, E('p', {}, [
						_('数据目录必须在 /mnt 下：面板的数据库和应用都写这里')
					]), 'warning');
					return;
				}

				installBtn.disabled = true;
				installBtn.textContent = _('安装进行中…');

				return run([ 'install', fPort.input.value, fUser.input.value,
					fPass.input.value, fEnt.input.value, fDir.input.value ], _('安装本地版'));
			});

			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('安装本地版 1Panel') ]),
				E('div', { 'class': 'cbi-map-descr' }, [
					_('从官方源拉安装包，用官方 install.sh 安装（OpenWrt 上用 procd 托管）。'),
					E('br'),
					_('端口、账号、密码、入口路径都可指定；数据目录必须在 /mnt 下。'),
					E('br'),
					_('两个二进制约 152MB 会写到 overlay，装完刷新即用。')
				]),
				blk || '',
				kept
					? E('div', { 'class': 'p1-warn', 'style': 'margin:.6rem 0' }, [
						_('检测到 %s 里已有面板数据：账号、密码、入口会沿用旧值，表单里的值不生效。')
							.format(st.native_datadir || '')
					])
					: '',
				E('div', { 'class': 'p1-form', 'style': 'margin-top:1rem' },
					[].concat(fPort.nodes, fUser.nodes, fPass.nodes, fEnt.nodes, fDir.nodes)),
				E('div', { 'style': 'margin-top:1rem' }, [ installBtn ]),
				taskBox(st)
			]);
		}

		function drawPane(force) {
			var st = state.st;
			var sig = [
				state.tab,
				st.kind, st.container_present, st.native_present,
				st.container_running, st.native_running,
				st.container_version, st.native_version,
				st.task, state.latest,
				flag(st.docker), flag(st.conflict)
			].join('|');

			/* 用户在表单里打字时不能被轮询重画，只有状态真的变了才重建。 */
			if (!force && sig === state.sig)
				return;

			state.sig = sig;

			clear(paneWrap);
			paneWrap.appendChild(state.tab === 'container' ? containerPane(st) : nativePane(st));
		}

		function drawAll(force) {
			drawHead(state.st);
			drawTabs(state.st);
			drawPane(force);
		}

		function refresh(force) {
			return call([ 'status' ]).then(function(res) {
				var fresh = parseKV(res.text);

				state.st = fresh;
				state.latest = fresh.latest || state.latest;
				drawAll(force);
				return fresh;
			});
		}

		drawAll(true);

		poll.add(function() {
			return refresh(false);
		}, 8);

		return E('div', {}, [
			E('style', {}, [ CSS ]),
			E('h2', {}, [ _('1Panel') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('同一台机器上二选一：容器版（docker compose，镜像自带面板）或本地版（procd 托管的裸二进制）。'),
				E('br'),
				_('两套会抢同一个端口和数据目录，装了一套就不能再装另一套，页面上的状态会写清是哪一种。')
			]),
			headWrap,
			tabWrap,
			paneWrap,
			out
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
