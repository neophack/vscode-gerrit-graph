/**
 * End-to-end webview simulation of the Git Bisect integration:
 * - the BISECT banner is hidden when no bisect session is in progress,
 * - an in-progress session shows Good/Bad/Current and the action buttons,
 * - commits marked good/bad carry GOOD/BAD badges in the commit table,
 * - clicking the banner buttons sends bisectMark (bad/good/skip) messages,
 * - a converged bisect (first bad commit found) shows the result row, a
 *   ★ FIRST BAD badge, and View Commit / End Bisect buttons,
 * - End Bisect asks for confirmation and sends a bisectReset message.
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
const BAD_HASH = 'e83bd8dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const MID_HASH = 'a1c0ffeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const GOOD_HASH = '65698d2cccccccccccccccccccccccccccccccc';

const COMMIT_BAD = { hash: BAD_HASH, parents: [], heads: [], tags: [], remotes: [], stash: null, author: 'Dev', email: 'dev@example.com', date: 1755000000, message: 'broken build' };
const COMMIT_MID = { hash: MID_HASH, parents: [], heads: [], tags: [], remotes: [], stash: null, author: 'Dev', email: 'dev@example.com', date: 1754500000, message: 'bisect candidate' };
const COMMIT_GOOD = { hash: GOOD_HASH, parents: [], heads: ['main'], tags: [], remotes: [], stash: null, author: 'Dev', email: 'dev@example.com', date: 1754000000, message: 'all good' };

const COMMITS = [COMMIT_BAD, COMMIT_MID, COMMIT_GOOD];

const BISECT_IN_PROGRESS = { inProgress: true, goodHashes: [GOOD_HASH], badHashes: [BAD_HASH], firstBadCommit: null };

function makeState() {
	return {
		avatar: null,
		config: {
			commitOrdering: 'date',
			commitDetailsView: { autoCenter: true, fileViewCompactFolders: true, fileViewType: 'File Tree', location: 'Inline' },
			contextMenuActionsVisibility: {},
			customBranchGlobPatterns: [], customEmojiShortcodeMappings: [], customPullRequestProviders: [],
			dateFormat: { type: 'relative', short: true, iso: false, string: '' },
			defaultColumnVisibility: { date: true, author: true, commit: true, signature: false },
			dialogDefaults: {}, enhancedAccessibility: false,
			fetchAndPrune: false, fetchAndPruneTags: false, fetchAvatars: false,
			gerrit: {
				enabled: false, remote: 'origin', fetchMode: 'latest', fetchLimit: 10, patchsets: 'latest', autoFetch: false,
				showChangeRefs: false, includeChangeCommits: false, showReviewProgress: false,
				showMetaCommits: 'off', statusFilter: { new: true, merged: false, abandoned: false, wip: false },
				showPushButton: false
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
			pinnedBranches: [], pinnedCommits: [],
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
		'<span id="gerritFilterControl"></span><div id="gerritAmendBtn"></div><div id="gerritSubmitBtn"></div><div id="gerritClearRefsBtn"></div></div>' +
	'<div id="pinnedControls" style="display:none"><span class="unselectable pinnedRowLabel">Pinned:</span></div>' +
	'<div id="bisectBanner" class="bisectBanner" style="display:none"></div>' +
	'<div id="content"><div id="commitGraph"></div><div id="commitTable"></div></div>' +
	'<div id="footer"></div></div>';

function loadWebview(state: any) {
	document.body.innerHTML = VIEW_HTML;
	(globalThis as any).acquireVsCodeApi = () => ({
		postMessage: (msg: any) => { sentMessages.push(msg); return undefined; },
		getState: () => webviewState,
		setState: (s: any) => { webviewState = s; }
	});
	const script = fs.readFileSync(path.join(__dirname, '..', 'media', 'out.min.js'), 'utf8');
	// eslint-disable-next-line no-eval
	eval('var initialState = ' + JSON.stringify(state) + ', globalState = ' + JSON.stringify({ avatars: {} }) + ', workspaceState = ' + JSON.stringify({}) + ';\n' + script);
	window.dispatchEvent(new Event('load'));
}

/**
 * Respond to the latest outstanding loadRepoInfo / loadCommits requests.
 */
function respondToPendingLoads(bisect: any, commits: any[], head: string | null) {
	const repoInfoMsg = sentMessages.filter((m) => m.command === 'loadRepoInfo').pop();
	if (repoInfoMsg !== undefined) {
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'loadRepoInfo', refreshId: repoInfoMsg.refreshId, error: null,
			branches: ['main'], head: 'main', remotes: ['origin'], stashes: [], isRepo: true, bisect: bisect
		} }));
	}
	const loadMsg = sentMessages.filter((m) => m.command === 'loadCommits').pop();
	if (loadMsg !== undefined) {
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'loadCommits', refreshId: loadMsg.refreshId, error: null, head: head, tags: [],
			moreAvailable: false, onlyFollowFirstParent: false, gerritStates: [], commits: commits
		} }));
	}
}

function respondToInitialLoad(bisect: any, head: string | null = MID_HASH) {
	respondToPendingLoads(bisect, COMMITS, head);
}

function clickBannerButton(action: string) {
	const btn = Array.from(document.querySelectorAll('#bisectBanner .bisectBannerBtn')).find((b: any) => b.dataset.action === action) as any;
	expect(btn).toBeDefined();
	btn.click();
}

describe('Webview bisect simulation', () => {
	let scrollCalls: number[];

	beforeEach(() => {
		jest.clearAllMocks();
		sentMessages.length = 0;
		webviewState = undefined;
		scrollCalls = [];
		(window as any).Element.prototype.scroll = function () { scrollCalls.push(this.id); return undefined; };
	});

	test('the bisect banner stays hidden when no bisect session is in progress', () => {
		loadWebview(makeState());
		respondToInitialLoad(null);

		const banner = document.getElementById('bisectBanner');
		expect(banner.style.display).toBe('none');
		expect(document.querySelector('tr.commit .bisectBadge')).toBeNull();
	});

	test('an in-progress session shows the banner with Good/Bad/Current and the action buttons', () => {
		loadWebview(makeState());
		respondToInitialLoad(BISECT_IN_PROGRESS);

		const banner = document.getElementById('bisectBanner');
		expect(banner.style.display).not.toBe('none');
		expect(banner.textContent).toContain('BISECT');
		expect(banner.textContent).toContain('Good: ' + GOOD_HASH.substring(0, 8));
		expect(banner.textContent).toContain('Bad: ' + BAD_HASH.substring(0, 8));
		expect(banner.textContent).toContain('Current: ' + MID_HASH.substring(0, 8));

		for (const action of ['markBad', 'markGood', 'markSkip', 'endBisect']) {
			expect(Array.from(banner.querySelectorAll('.bisectBannerBtn')).some((b: any) => b.dataset.action === action)).toBe(true);
		}
	});

	test('commits marked good/bad during the session carry BAD/GOOD badges', () => {
		loadWebview(makeState());
		respondToInitialLoad(BISECT_IN_PROGRESS);

		const badBadge = document.querySelector('tr.commit[data-id="0"] .bisectBadge.bad');
		const goodBadge = document.querySelector('tr.commit[data-id="2"] .bisectBadge.good');
		expect(badBadge).not.toBeNull();
		expect(badBadge.textContent).toBe('BAD');
		expect(goodBadge).not.toBeNull();
		expect(goodBadge.textContent).toBe('GOOD');
		// The current (unmarked) bisect commit has no badge
		expect(document.querySelector('tr.commit[data-id="1"] .bisectBadge')).toBeNull();
	});

	test.each([
		['markBad', 'bad'],
		['markGood', 'good'],
		['markSkip', 'skip']
	])('clicking the %s banner button sends a bisectMark message for the current commit', (action: string, mark: string) => {
		loadWebview(makeState());
		respondToInitialLoad(BISECT_IN_PROGRESS);

		clickBannerButton(action);

		const msg = sentMessages.filter((m) => m.command === 'bisectMark').pop();
		expect(msg).toBeDefined();
		expect(msg.repo).toBe(REPO);
		expect(msg.mark).toBe(mark);
		expect(msg.commitHash).toBe(null);
	});

	test('a converged bisect shows the first bad commit result, a ★ badge, and View Commit / End Bisect buttons', () => {
		loadWebview(makeState());
		respondToInitialLoad(BISECT_IN_PROGRESS);

		// Mark the current commit as bad; Git reports the first bad commit
		clickBannerButton('markBad');
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'bisectMark', error: null, firstBadCommit: MID_HASH
		} }));

		// Respond to the refresh triggered by the successful action
		respondToPendingLoads(BISECT_IN_PROGRESS, COMMITS, MID_HASH);

		const banner = document.getElementById('bisectBanner');
		expect(banner.textContent).toContain(MID_HASH.substring(0, 8) + ' is the first bad commit');
		// The convergence UI replaces the good/bad/skip triage buttons
		expect(Array.from(banner.querySelectorAll('.bisectBannerBtn')).some((b: any) => b.dataset.action === 'markGood')).toBe(false);
		expect(Array.from(banner.querySelectorAll('.bisectBannerBtn')).some((b: any) => b.dataset.action === 'viewCommit')).toBe(true);
		expect(Array.from(banner.querySelectorAll('.bisectBannerBtn')).some((b: any) => b.dataset.action === 'endBisect')).toBe(true);

		// The first bad commit carries the ★ FIRST BAD badge
		const firstBadBadge = document.querySelector('tr.commit[data-id="1"] .bisectBadge.firstBad');
		expect(firstBadBadge).not.toBeNull();
		expect(firstBadBadge.textContent).toContain('FIRST BAD');
	});

	test('clicking View Commit in the converged banner scrolls to the first bad commit', () => {
		loadWebview(makeState());
		respondToInitialLoad(BISECT_IN_PROGRESS);

		clickBannerButton('markBad');
		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'bisectMark', error: null, firstBadCommit: MID_HASH
		} }));
		respondToPendingLoads(BISECT_IN_PROGRESS, COMMITS, MID_HASH);

		clickBannerButton('viewCommit');
		expect(scrollCalls).toContain('view');
	});

	test('ending the bisect asks for confirmation, then sends a bisectReset message', () => {
		loadWebview(makeState());
		respondToInitialLoad(BISECT_IN_PROGRESS);

		clickBannerButton('endBisect');

		// Nothing is sent until the confirmation dialog is accepted
		expect(sentMessages.filter((m) => m.command === 'bisectReset').length).toBe(0);
		const confirmBtn = document.getElementById('dialogAction');
		expect(confirmBtn).not.toBeNull();
		expect(confirmBtn.textContent).toContain('Yes, end bisect');
		confirmBtn.click();

		const msg = sentMessages.filter((m) => m.command === 'bisectReset').pop();
		expect(msg).toBeDefined();
		expect(msg.repo).toBe(REPO);
	});

	test('after a bisectReset completes, the banner is hidden again', () => {
		loadWebview(makeState());
		respondToInitialLoad(BISECT_IN_PROGRESS);

		clickBannerButton('endBisect');
		document.getElementById('dialogAction').click();

		window.dispatchEvent(new MessageEvent('message', { data: {
			command: 'bisectReset', error: null
		} }));
		respondToPendingLoads(null, COMMITS, GOOD_HASH);

		const banner = document.getElementById('bisectBanner');
		expect(banner.style.display).toBe('none');
		expect(document.querySelector('tr.commit .bisectBadge')).toBeNull();
	});
});
