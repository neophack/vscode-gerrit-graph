/**
 * End-to-end webview simulation: Gerrit filter chips must trigger a loadCommits
 * request carrying the updated status filter, and the commit table must re-render
 * when the extension responds (badges appear/disappear).
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

const COMMIT_MERGED = { hash: 'e83bd8dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', parents: [], heads: [], tags: [], remotes: [], stash: null, author: 'Dev', email: 'dev@example.com', date: 1755000000, message: 'merged change commit' };
const COMMIT_PLAIN = { hash: '65698d2cccccccccccccccccccccccccccccccc', parents: [], heads: ['develop'], tags: [], remotes: [{ name: 'origin/develop', remote: 'origin' }], stash: null, author: 'Dev', email: 'dev@example.com', date: 1754000000, message: 'plain commit' };

function makeState() {
	return {
		avatar: null,
		config: {
			commitOrdering: 'date',
			commitDetailsView: { autoCenter: true, fileTreeCompactFolders: true, fileViewType: 'File Tree', location: 'Inline' },
			contextMenuActionsVisibility: {},
			customBranchGlobPatterns: [], customEmojiShortcodeMappings: [], customPullRequestProviders: [],
			dateFormat: { type: 'relative', short: true, iso: false, string: '' },
			defaultColumnVisibility: { date: true, author: true, commit: true, signature: false },
			dialogDefaults: {}, enhancedAccessibility: false,
			fetchAndPrune: false, fetchAndPruneTags: false, fetchAvatars: false,
			gerrit: {
				enabled: true, remote: 'origin', fetchMode: 'latest', fetchLimit: 10, patchsets: 'latest', autoFetch: false,
				showChangeRefs: true, includeChangeCommits: true, showReviewProgress: true,
				showMetaCommits: 'collapsed', statusFilter: { new: true, merged: false, abandoned: false, wip: false },
				showPushButton: true
			},
			graph: { colours: ['#0085d9'], style: 'rounded', issueLinking: {}, grid: { x: 10, y: 24, offsetX: 8, offsetY: 8, expandY: 8 } },
			initialLoadCommits: 500, keybindings: {}, loadMoreCommits: 100, loadMoreCommitsAutomatically: true,
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
let webviewState: any; // simulates the state storage behind VSCODE_API.getState/setState

const VIEW_HTML = '<div id="view" tabindex="-1">' +
	'<div id="controls"><span id="repoControl"><div id="repoDropdown" class="dropdown"></div></span>' +
	'<span id="branchControl"><div id="branchDropdown" class="dropdown"></div></span>' +
	'<span id="authorControl"><div id="authorDropdown" class="dropdown"></div></span>' +
	'<label id="showRemoteBranchesControl"><input type="checkbox" id="showRemoteBranchesCheckbox"></label>' +
	'<div id="currentBtn"></div><div id="findBtn"></div><div id="terminalBtn"></div><div id="settingsBtn"></div><div id="fetchBtn"></div><div id="refreshBtn"></div></div>' +
	'<div id="gerritControls"><span class="gerritRowLabel">Gerrit:</span>' +
	'<label id="gerritShowRefsControl"><input type="checkbox" id="gerritShowRefsCheckbox"></label>' +
		'<span id="gerritFilterControl"></span><div id="gerritAmendBtn"></div><div id="gerritSubmitBtn"></div><div id="gerritClearRefsBtn"></div></div>' +
	'<div id="content"><div id="commitGraph"></div><div id="commitTable"></div></div>' +
	'<div id="footer"></div></div>';

function loadWebview() {
	document.body.innerHTML = VIEW_HTML;
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
		branches: ['develop'], head: 'develop', remotes: ['origin'], stashes: [], isRepo: true
	} }));
}

describe('Webview Gerrit chip simulation', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		sentMessages.length = 0;
		webviewState = undefined;

		(window as any).Element.prototype.scroll = () => undefined;
		loadWebview();
	});

	test('clicking a chip sends loadCommits with the updated filter and re-renders on response', () => {
		// 1. Extension responds to the initial loadRepoInfo
		const repoInfoMsg = sentMessages.find((m) => m.command === 'loadRepoInfo');
		expect(repoInfoMsg).toBeDefined();
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'loadRepoInfo', refreshId: repoInfoMsg.refreshId, error: null,
			branches: ['develop'], head: 'develop', remotes: ['origin'], stashes: [], isRepo: true
		} }));

		// 2. Extension responds to the initial loadCommits (default filter: only open changes -> no gerrit states)
		const loadMsg1 = sentMessages.filter((m) => m.command === 'loadCommits').pop();
		expect(loadMsg1).toBeDefined();
		expect(loadMsg1.gerritStatusFilter).toEqual({ new: true, merged: false, abandoned: false, wip: false });
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'loadCommits', refreshId: loadMsg1.refreshId, error: null, head: 'develop', tags: [],
			moreAvailable: false, onlyFollowFirstParent: false,
			gerritStates: [],
			commits: [COMMIT_PLAIN]
		} }));
		expect(document.querySelectorAll('tr.commit').length).toBe(1);
		expect(document.querySelector('.gitRef.gerrit')).toBeNull();

		// 3. Click the "Merged" chip
		const mergedChip: any = Array.from(document.querySelectorAll('.gerritFilterChip')).find((c: any) => c.dataset.status === 'merged');
		expect(mergedChip.classList.contains('active')).toBe(false);
		mergedChip.click();
		expect(mergedChip.classList.contains('active')).toBe(true);

		// 4. A new loadCommits request must be sent, carrying merged: true
		const loadMsg2 = sentMessages.filter((m) => m.command === 'loadCommits').pop();
		expect(loadMsg2.gerritStatusFilter).toEqual({ new: true, merged: true, abandoned: false, wip: false });

		// 5. Extension responds with the merged change state + its commit
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'loadCommits', refreshId: loadMsg2.refreshId, error: null, head: 'develop', tags: [],
			moreAvailable: false, onlyFollowFirstParent: false,
			gerritStates: [{
				change: 41456, patchset: 1, codeReview: 2, verified: 1, status: 'merged', wip: false,
				headHash: COMMIT_MERGED.hash, events: [{ type: 'merged', patchset: 1, timestamp: 1755000000, raw: 'Change has been successfully merged' }], url: null
			}],
			commits: [COMMIT_MERGED, COMMIT_PLAIN]
		} }));

		// 6. The table must re-render: the change commit appears with a Gerrit badge and meta chip
		expect(document.querySelectorAll('tr.commit').length).toBe(2);
		const badge = document.querySelector('.gitRef.gerrit');
		expect(badge).not.toBeNull();
		expect(badge.textContent).toContain('#41456/1');
		expect(badge.textContent).toContain('CR+2');

		// 7. Toggling Show Refs off removes the badge locally (no new request)
		const before = sentMessages.length;
		const showRefs = document.getElementById('gerritShowRefsCheckbox');
		showRefs.checked = false;
		showRefs.dispatchEvent(new Event('change'));
		expect(document.querySelector('.gitRef.gerrit')).toBeNull();
		expect(sentMessages.length).toBe(before);

		// 8. Clicking the meta chip expands in-table meta rows (no request)
		showRefs.checked = true;
		showRefs.dispatchEvent(new Event('change'));
		expect(document.querySelector('.gitRef.gerrit')).not.toBeNull();
		expect(document.querySelector('.gg-meta-chip')).not.toBeNull();
		(document.querySelector('.gg-meta-chip') as any).click();
		expect(document.querySelectorAll('tr.gg-meta-row').length).toBe(1);
		expect(document.querySelector('tr.gg-meta-row').textContent).toContain('merged');
		(document.querySelector('.gg-meta-chip') as any).click();
		expect(document.querySelectorAll('tr.gg-meta-row').length).toBe(0);
	});

	test('the review dialog shows the expandable full NoteDb record of each event', () => {
		// 1. Load commits with a merged change whose events carry the full NoteDb records (rawFull)
		respondToRepoInfo();
		const loadMsg = sentMessages.filter((m) => m.command === 'loadCommits').pop();
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'loadCommits', refreshId: loadMsg.refreshId, error: null, head: 'develop', tags: [],
			moreAvailable: false, onlyFollowFirstParent: false,
			gerritStates: [{
				change: 41456, patchset: 1, codeReview: 2, verified: 1, status: 'merged', wip: false,
				headHash: COMMIT_MERGED.hash,
				events: [
					{ type: 'merged', patchset: 1, timestamp: 1755000000, raw: 'Change has been successfully merged', rawFull: 'Change has been successfully merged\n\nPatch-set: 1\nCommit: e83bd8db\nStatus: merged\nSubmitted-with: OK\n' },
					{ type: 'created', patchset: 1, timestamp: 1754900000, raw: 'Create change' } // legacy event without rawFull
				],
				url: null
			}],
			commits: [COMMIT_MERGED, COMMIT_PLAIN]
		} }));

		// 2. Clicking the Gerrit badge opens the review dialog with one row per event (newest first)
		(document.querySelector('.gitRef.gerrit') as any).click();
		const events = document.querySelectorAll('.gg-event');
		expect(events.length).toBe(2);
		expect(document.body.textContent).toContain('Gerrit Change #41456');

		// 3. The newest event has a detail block, hidden until its row is clicked
		const mergedEvent: any = events[0];
		expect(mergedEvent.querySelector('.gg-event-detail')).not.toBeNull();
		expect(mergedEvent.classList.contains('expanded')).toBe(false);
		mergedEvent.click();
		expect(mergedEvent.classList.contains('expanded')).toBe(true);
		expect(mergedEvent.querySelector('.gg-event-detail').textContent).toContain('Patch-set: 1');
		expect(mergedEvent.querySelector('.gg-event-detail').textContent).toContain('Status: merged');
		mergedEvent.click();
		expect(mergedEvent.classList.contains('expanded')).toBe(false);

		// 4. Legacy events (persisted before rawFull existed) render no detail block and never expand
		const createdEvent: any = events[1];
		expect(createdEvent.querySelector('.gg-event-detail')).toBeNull();
		createdEvent.click();
		expect(createdEvent.classList.contains('expanded')).toBe(false);
	});

	test('the chip selection is restored when the webview is reloaded (e.g. switching away from the panel and back)', () => {
		// 1. Initial load (default filter: only open changes)
		respondToRepoInfo();
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'loadCommits', refreshId: sentMessages.filter((m) => m.command === 'loadCommits').pop().refreshId, error: null, head: 'develop', tags: [],
			moreAvailable: false, onlyFollowFirstParent: false, gerritStates: [], commits: [COMMIT_PLAIN]
		} }));

		// 2. Click the "Merged" chip and let the extension respond (served from the Gerrit cache)
		const mergedChip: any = Array.from(document.querySelectorAll('.gerritFilterChip')).find((c: any) => c.dataset.status === 'merged');
		mergedChip.click();
		const loadMsg = sentMessages.filter((m) => m.command === 'loadCommits').pop();
		expect(loadMsg.gerritStatusFilter).toEqual({ new: true, merged: true, abandoned: false, wip: false });
		expect(loadMsg.gerritForceRefresh).toBe(false); // chip toggles must use the Gerrit cache
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'loadCommits', refreshId: loadMsg.refreshId, error: null, head: 'develop', tags: [],
			moreAvailable: false, onlyFollowFirstParent: false,
			gerritStates: [{
				change: 41456, patchset: 1, codeReview: 2, verified: 1, status: 'merged', wip: false,
				headHash: COMMIT_MERGED.hash, events: [], url: null
			}],
			commits: [COMMIT_MERGED, COMMIT_PLAIN]
		} }));

		// 3. The selection must have been persisted to the webview state
		expect(webviewState.gerritStatusFilter).toEqual({ new: true, merged: true, abandoned: false, wip: false });

		// 4. Simulate the webview being reloaded (the panel was hidden and re-shown)
		loadWebview();

		// 5. The chip must still be selected, and the Gerrit badges must render immediately from the restored state
		const restoredChip: any = Array.from(document.querySelectorAll('.gerritFilterChip')).find((c: any) => c.dataset.status === 'merged');
		expect(restoredChip.classList.contains('active')).toBe(true);
		expect(document.querySelector('.gitRef.gerrit')).not.toBeNull();

		// 6. The initial load of the reloaded view must carry the restored filter (served from the Gerrit cache)
		respondToRepoInfo();
		const reloadMsg = sentMessages.filter((m) => m.command === 'loadCommits').pop();
		expect(reloadMsg.gerritStatusFilter).toEqual({ new: true, merged: true, abandoned: false, wip: false });
		expect(reloadMsg.gerritForceRefresh).toBe(false);
	});

	test('clicking Refresh forces a Gerrit re-fetch, while normal loads use the cache', () => {
		// 1. Initial load must not force a Gerrit re-fetch
		respondToRepoInfo();
		const loadMsg1 = sentMessages.filter((m) => m.command === 'loadCommits').pop();
		expect(loadMsg1.gerritForceRefresh).toBe(false);
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'loadCommits', refreshId: loadMsg1.refreshId, error: null, head: 'develop', tags: [],
			moreAvailable: false, onlyFollowFirstParent: false, gerritStates: [], commits: [COMMIT_PLAIN]
		} }));

		// 2. Clicking the Refresh button must set gerritForceRefresh on the next loadCommits request
		document.getElementById('refreshBtn')!.click();
		respondToRepoInfo();
		const loadMsg2 = sentMessages.filter((m) => m.command === 'loadCommits').pop();
		expect(loadMsg2.gerritForceRefresh).toBe(true);
	});
});
