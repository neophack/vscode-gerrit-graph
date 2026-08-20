const path = require('path');
const Module = require('module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r === 'vscode') return require.resolve('./gerritShim.js'); return orig.call(this, r, ...a); };
(async () => {
	const utils = require('../../out/utils.js');
	const DataSource = require('../../out/dataSource.js').DataSource;
	const g = require('../../out/gerrit.js');
	const git = await utils.getGitExecutable('git');
	const ds = new DataSource(git, () => ({ dispose() {} }), () => {}, { log() {}, logCmd() {} });
	const gs = new g.GerritDataSource(ds);
	const repo = process.argv[2];
	const url = await gs.getChangeUrlBase(repo, 'origin');
	for (const c of [41455, 41456]) {
		const s = await gs.parseMeta(repo, 'origin', c, url);
		if (s === null) { console.log('=== Change #' + c + ': meta unavailable ==='); continue; }
		console.log('=== Change #' + c + ' PS' + s.patchset + ' [' + s.status + '] CR=' + s.codeReview + ' V=' + s.verified + ' ===');
		for (const e of s.events.slice().reverse()) {
			console.log('  ' + new Date(e.timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ') + '  ' + e.type.padEnd(9) + ' ' + e.raw +
				(e.labels ? ' (' + e.labels.map((l) => l.name + (l.value > 0 ? '+' : '') + l.value).join(', ') + ')' : '') +
				(e.reviewer ? '  — ' + e.reviewer : ''));
		}
		console.log('  URL: ' + s.url);
	}
})().catch((e) => { console.error(e); process.exit(1); });
