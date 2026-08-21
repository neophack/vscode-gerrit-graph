/**
 * "Load More Commits" paging simulation tests: when the incoming commit list is a
 * pure extension of the rendered one, the webview must append only the new rows
 * (keeping the existing DOM nodes) instead of re-rendering the entire table; when
 * the list differs (e.g. refs changed), a full re-render must still occur.
 */
/**
 * @jest-environment jsdom
 */
import * as fs from 'fs';
import * as path from 'path';

declare const document: any;
declare const window: any;
declare const Event: any;
declare const MessageEvent: any;

const REPO = '/path/to/repo';

const hash = (c: string) => c.padEnd(40, '0').substring(0, 40);

function makeCommit(n: number, extraHeads: string[] = []) {
	return {
		hash: hash(n.toString(16)), parents: n > 0 ? [hash((n - 1).toString(16))] : [], heads: extraHeads, tags: [], remotes: [],
		stash: null, author: 'Dev', email: 'dev@example.com', date: 1750000000 + n, message: 'commit ' + n
	};
}

// A linear history of 9 commits (0 = oldest/root, 8 = newest/head), listed newest-first as the
// webview expects (each commit's parent appears at a LATER position in the list)
const ALL_COMMITS = Array.from({ length: 9 }, (_, n) => makeCommit(n, n === 8 ? ['main'] : []));
const HEAD_HASH = ALL_COMMITS[8].hash;
const FIRST_PAGE = ALL_COMMITS.slice(3).reverse(); // commits 8..3 (newest first)
const SECOND_PAGE = ALL_COMMITS.slice().reverse(); // commits 8..0 (newest first)

function makeState() {
	return {
		avatar: null,
		config: {
			commitOrdering: 'date',
			commitDetailsView: { autoCenter: true, fileTreeCompactFolders: true, fileViewType: 'File Tree', location: 'Inline' },
			contextMenuActionsVisibility: {}, customBranchGlobPatterns: [], customEmojiShortcodeMappings: [], customPullRequestProviders: [],
			dateFormat: { type: 'relative', short: true, iso: false, string: '' },
			defaultColumnVisibility: { date: true, author: true, commit: true, signature: false },
			dialogDefaults: {}, enhancedAccessibility: false,
			fetchAndPrune: false, fetchAndPruneTags: false, fetchAvatars: false,
			gerrit: {
				enabled: false, remote: 'origin', fetchMode: 'latest', fetchLimit: 10, patchsets: 'latest', autoFetch: false,
				showChangeRefs: true, includeChangeCommits: true, showReviewProgress: true,
				showMetaCommits: 'collapsed', statusFilter: { new: true, merged: false, abandoned: false, wip: false },
				showPushButton: true
			},
			graph: { colours: ['#0085d9'], style: 'rounded', issueLinking: {}, grid: { x: 10, y: 24, offsetX: 8, offsetY: 8, expandY: 8 } },
			initialLoadCommits: 6, keybindings: {}, loadMoreCommits: 3, loadMoreCommitsAutomatically: false,
			markdown: false, mute: { commitsNotAncestorsOfHead: false, mergeCommits: false }, onRepoLoad: { showCheckedOutBranch: null, showSpecificBranches: [] }, referenceLabels: { branchLabelsAlignedToGraph: false, combineLocalAndRemoteBranchLabels: true, tagLabelsOnRight: false },
			showCommitBodyInline: false, stickyHeader: true, tabIconColourTheme: 'colour'
		},
		lastActiveRepo: REPO,
		loadViewTo: null,
		repos: { [REPO]: {
			cdvDivider: 50, cdvHeight: 50, columnWidths: null, commitOrdering: 'default', fileViewType: null, hideRemotes: [],
			includeCommitsMentionedByReflogs: null, issueLinkingConfig: {}, lastImportAt: 0, name: 'repo',
			onlyFollowFirstParent: null, onRepoLoadShowCheckedOutBranch: null, onRepoLoadShowSpecificBranches: null,
			pullRequestConfig: null, showRemoteBranches: false, showRemoteBranchesV2: null, showStashes: null,
			showTags: null, workspaceFolderIndex: null
		} },
		loadRepoInfoRefreshId: 1,
		loadCommitsRefreshId: 1
	};
}

const sentMessages: any[] = [];
let webviewState: any;

const VIEW_HTML = '<div id="view" tabindex="-1">' +
	'<div id="controls"><span id="repoControl"><div id="repoDropdown" class="dropdown"></div></span>' +
	'<span id="branchControl"><div id="branchDropdown" class="dropdown"></div></span>' +
	'<span id="authorControl"><div id="authorDropdown" class="dropdown"></div></span>' +
	'<label id="showRemoteBranchesControl"><input type="checkbox" id="showRemoteBranchesCheckbox"></label>' +
	'<div id="currentBtn"></div><div id="findBtn"></div><div id="terminalBtn"></div><div id="settingsBtn"></div><div id="fetchBtn"></div><div id="refreshBtn"></div></div>' +
	'<div id="gerritControls"><span class="gerritRowLabel">Gerrit:</span>' +
		'<span id="gerritFilterControl"></span><div id="gerritAmendBtn"></div><div id="gerritSubmitBtn"></div><div id="gerritClearRefsBtn"></div></div>' +
	'<div id="content"><div id="commitGraph"></div><div id="commitTable"></div></div>' +
	'<div id="footer"></div></div>';

function loadWebview() {
	document.body.innerHTML = VIEW_HTML;
	(window as any).Element.prototype.scroll = () => undefined;
	// The resize handler uses requestAnimationFrame: run frames synchronously in tests
	window.requestAnimationFrame = (cb: any) => { cb(); return 0; };
	window.cancelAnimationFrame = () => undefined;
	(globalThis as any).acquireVsCodeApi = () => ({
		postMessage: (msg: any) => { sentMessages.push(msg); return undefined; },
		getState: () => webviewState,
		setState: (state: any) => { webviewState = state; }
	});
	const script = fs.readFileSync(path.join(__dirname, '..', 'media', 'out.min.js'), 'utf8');
	// eslint-disable-next-line no-eval
	eval('var initialState = ' + JSON.stringify(makeState()) + ', globalState = ' + JSON.stringify({ avatars: {} }) + ', workspaceState = ' + JSON.stringify({}) + ';\n' + script);
	window.dispatchEvent(new Event('load'));
}

function respondToRepoInfo() {
	const repoInfoMsg = sentMessages.filter((m) => m.command === 'loadRepoInfo').pop();
	expect(repoInfoMsg).toBeDefined();
	window.dispatchEvent(new MessageEvent('message', { data: {
		command: 'loadRepoInfo', refreshId: repoInfoMsg.refreshId, error: null,
		branches: ['main'], head: 'main', remotes: [], stashes: [], isRepo: true
	} }));
}

function respondToLoadCommits(commits: any[], moreAvailable: boolean, head: string = HEAD_HASH) {
	const loadMsg = sentMessages.filter((m) => m.command === 'loadCommits').pop();
	expect(loadMsg).toBeDefined();
	window.dispatchEvent(new MessageEvent('message', { data: {
		command: 'loadCommits', refreshId: loadMsg.refreshId, error: null, head: head, tags: [],
		moreCommitsAvailable: moreAvailable, onlyFollowFirstParent: false, gerritStates: [], commits: commits
	} }));
}

function row(id: number) {
	return document.querySelector('tr.commit[data-id="' + id + '"]');
}

function clickLoadMore() {
	const btn = document.getElementById('loadMoreCommitsBtn');
	expect(btn).not.toBeNull();
	btn.click();
}

describe('Webview load-more paging simulation', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		sentMessages.length = 0;
		webviewState = undefined;
		loadWebview();
	});

	test('the initial page renders with a Load More button that requests a larger page', () => {
		respondToRepoInfo();
		respondToLoadCommits(FIRST_PAGE, true);

		expect(document.querySelectorAll('tr.commit').length).toBe(6);
		expect(document.getElementById('loadMoreCommitsBtn')).not.toBeNull();

		clickLoadMore();
		const msg = sentMessages.filter((m) => m.command === 'loadCommits').pop();
		expect(msg.maxCommits).toBe(9); // initialLoadCommits (6) + loadMoreCommits (3)
	});

	test('a paging response that extends the loaded commits appends rows without replacing them', () => {
		respondToRepoInfo();
		respondToLoadCommits(FIRST_PAGE, true);
		const existingRows = [0, 1, 2, 3, 4, 5].map((id) => row(id));
		expect(existingRows.every((r: any) => r !== null)).toBe(true);

		clickLoadMore();
		// The view reports a real width from here on (jsdom measures 0 by default): the load-more
		// append path must re-apply the graph column auto layout, otherwise the widened graph SVG
		// (absolute, z-index above the table) overlaps the Description text
		Object.defineProperty(document.getElementById('view'), 'clientWidth', { value: 3000, configurable: true });
		respondToLoadCommits(SECOND_PAGE, true);

		// All previously rendered rows keep their DOM nodes (no full re-render)
		expect(existingRows.map((r: any) => r.isConnected)).toEqual([true, true, true, true, true, true]);
		expect(document.querySelectorAll('tr.commit').length).toBe(9);
		// The appended rows are rendered correctly, with continuing data-id sequence
		// (indices 6-8 of the extended list are commits 2, 1 and 0)
		expect(row(6).textContent).toContain('commit 2');
		expect(row(8).textContent).toContain('commit 0');
		// The graph is re-rendered for the new vertices
		expect(document.querySelectorAll('#commitGraph circle').length).toBeGreaterThanOrEqual(9);
		// The graph column layout was re-applied: the degenerate 0px width limit from the initial
		// render (jsdom clientWidth 0) is lifted, so the graph is no longer clipped/overlapping
		const table = document.getElementById('commitTable');
		expect(table.className).toBe('autoLayout');
		expect(table.style.getPropertyValue('--limitGraphWidth')).toBe('');
		expect(parseInt(document.querySelector('#commitGraph svg').getAttribute('width'), 10)).toBeGreaterThan(0);
		// Paging continues to be offered
		expect(document.getElementById('loadMoreCommitsBtn')).not.toBeNull();
	});

	test('the final page removes the Load More button but keeps the appended rows', () => {
		respondToRepoInfo();
		respondToLoadCommits(FIRST_PAGE, true);
		clickLoadMore();
		respondToLoadCommits(SECOND_PAGE, false);

		expect(document.querySelectorAll('tr.commit').length).toBe(9);
		expect(document.getElementById('loadMoreCommitsBtn')).toBeNull();
		expect(document.getElementById('footer').textContent).toBe('');
	});

	test('a paging response where an existing commit changed triggers a full re-render', () => {
		respondToRepoInfo();
		respondToLoadCommits(FIRST_PAGE, true);
		const oldRow = row(3);
		expect(oldRow).not.toBeNull();

		// A ref changed on an already rendered commit: the prefix is no longer identical
		const changed = SECOND_PAGE.map((c: any, i: number) => i === 3 ? Object.assign({}, c, { heads: ['feature'] }) : c);
		clickLoadMore();
		respondToLoadCommits(changed, true);

		expect(document.querySelectorAll('tr.commit').length).toBe(9);
		// The table was fully re-rendered: the old node was replaced by a new one showing the ref
		expect(oldRow.isConnected).toBe(false);
		expect(row(3).textContent).toContain('feature');
	});

	test('a paging response with a different head does not take the append path', () => {
		respondToRepoInfo();
		respondToLoadCommits(FIRST_PAGE, true);
		const oldRow = row(0);

		clickLoadMore();
		respondToLoadCommits(SECOND_PAGE, true, SECOND_PAGE[8].hash);

		// head changed: full re-render, current row moved to the new head
		expect(oldRow.isConnected).toBe(false);
		expect(row(8).className).toContain('current');
	});

	test('paging preserves the expanded commit details view', () => {
		respondToRepoInfo();
		respondToLoadCommits(FIRST_PAGE, true);

		// Expand the commit details of row 2 (a details request is sent; respond to it)
		row(2).querySelector('td:nth-child(2)').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		const detailsMsg = sentMessages.filter((m) => m.command === 'commitDetails').pop();
		expect(detailsMsg).toBeDefined();
		const commitDetailsMsgs = sentMessages.filter((m) => m.command === 'commitDetails');

		clickLoadMore();
		respondToLoadCommits(SECOND_PAGE, true);

		// The details view element survived the append (no full re-render would close/rebuild it)
		expect(document.getElementById('cdv')).not.toBeNull();
		expect(sentMessages.filter((m) => m.command === 'commitDetails').length).toBe(commitDetailsMsgs.length);
	});
});
