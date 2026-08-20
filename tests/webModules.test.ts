/**
 * @jest-environment jsdom
 *
 * Unit tests of the webview modules `web/graph.ts` (graph layout & colouring) and
 * `web/textFormatter.ts` (commit message formatting).
 *
 * The web sources are non-module scripts (they are concatenated into a single IIFE by the
 * production build), so this suite concatenates the required sources into a generated module
 * (tests/generated/webBundle.ts) at runtime, which ts-jest then compiles.
 */
import * as fs from 'fs';
import * as path from 'path';

declare const document: any;

/* Build the generated module exposing the classes under test */
const GENERATED_DIR = path.join(__dirname, 'generated');
const SOURCES = ['utils.ts', 'graph.ts', 'textFormatter.ts'];

if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR);
const concatenated = SOURCES.map((file) => fs.readFileSync(path.join(__dirname, '..', 'web', file), 'utf8')).join('\n');
// When ts-jest transpiles the generated file without the full type-checker, the ambient const
// enums from ../out/types.d.ts aren't inlined: their values are provided at runtime instead
// (mirroring the declarations in out/types.d.ts)
const GG_RUNTIME_ENUMS = 'const GG: any = { GraphStyle: { Rounded: 0, Angular: 1 }, GraphUncommittedChangesStyle: { OpenCircleAtTheUncommittedChanges: 0, OpenCircleAtTheCheckedOutCommit: 1 }, DateFormatType: { DateAndTime: 0, DateOnly: 1, Relative: 2 }, RepoDropdownOrder: { FullPath: 0, Name: 1, WorkspaceFullPath: 2 } };';
fs.writeFileSync(path.join(GENERATED_DIR, 'webBundle.ts'),
	'/* eslint-disable */\n' +
	'// GENERATED FILE - concatenated from web/ sources by tests/webModules.test.ts - do not edit\n' +
	'// @ts-nocheck (the concatenated sources are type-checked as part of web/tsconfig.json)\n' +
	GG_RUNTIME_ENUMS + '\n' +
	concatenated +
	'\nexport { Graph, TextFormatter };\n'
);

(globalThis as any).acquireVsCodeApi = () => ({ postMessage: () => undefined, getState: () => undefined, setState: () => undefined });
// textFormatter falls back to the `globalState` declared by web/main.ts (not concatenated here)
(globalThis as any).globalState = { issueLinkingConfig: null };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webBundle: { Graph: any, TextFormatter: any } = require('./generated/webBundle');
const Graph = webBundle.Graph, TextFormatter = webBundle.TextFormatter;


/* Graph */

const GRAPH_CONFIG = {
	colours: ['#00afff', '#ff0000', '#00ff00', '#ff00ff', '#0000ff'],
	fontSize: 12,
	rowHeight: 22,
	style: 0, // GraphStyle.Rounded
	grid: { x: 18, y: 22, offsetX: 9, offsetY: 11, expandY: 0 },
	uncommittedChanges: 0 // GraphUncommittedChangesStyle.OpenCircleAtTheUncommittedChanges
};

const MUTE_CONFIG = { commitsNotAncestorsOfHead: false, mergeCommits: false };

const commit = (hash: string, parents: string[], message: string) => ({
	hash: hash,
	parents: parents,
	heads: [],
	tags: [],
	remotes: [],
	stash: null,
	author: 'Author',
	email: 'author@example.com',
	date: 1592306634,
	message: message
});

/** Create the DOM structure required by the Graph constructor, and return the Graph instance. */
function createGraph() {
	document.body.innerHTML = '<div id="view"><div id="content"><div id="commitGraph"></div></div></div>';
	return new Graph('commitGraph', document.getElementById('view'), GRAPH_CONFIG, MUTE_CONFIG);
}

/**
 * A repository shape: a master branch, a feature branch that merges back, and a side branch.
 * IMPORTANT: the commits are ordered newest-first (exactly as returned by `git log`), so every
 * parent appears AFTER its children - the graph construction algorithm relies on this invariant.
 */
function sampleCommits() {
	return [
		commit('dddddddddddddddddddddddddddddddddddddddd', ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccccccccccc'], 'merge feature'),
		commit('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], 'master work'),
		commit('cccccccccccccccccccccccccccccccccccccccc', ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], 'feature work'),
		commit('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], 'side branch work'),
		commit('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [], 'root')
	];
}

/** Load the sample commits into a graph and render it once. */
function renderedGraph() {
	const graph = createGraph();
	const commits = sampleCommits();
	const lookup: { [hash: string]: number } = {};
	commits.forEach((c, i) => lookup[c.hash] = i);
	graph.loadCommits(commits, 'dddddddddddddddddddddddddddddddddddddddd', lookup, false);
	graph.render(null);
	return { graph: graph, commits: commits };
}

describe('web/graph.ts', () => {
	it('Should render a repository with merges without errors', () => {
		expect(() => renderedGraph()).not.toThrow();
	});

	it('Should assign a colour to every rendered commit', () => {
		const { graph, commits } = renderedGraph();
		const colours = graph.getVertexColours();
		expect(colours).toHaveLength(commits.length);
		for (const colour of colours) {
			expect(colour).toBeGreaterThanOrEqual(0);
			expect(colour).toBeLessThan(GRAPH_CONFIG.colours.length);
		}
	});

	it('Should continue the root colour onto its direct child, and use a new colour for diverging branches', () => {
		const { graph } = renderedGraph();
		const colours = graph.getVertexColours();
		// The master line (index 1) continues onto the root commit (index 4) with the same colour
		expect(colours[1]).toBe(colours[4]);
		// The feature branch (index 2) diverges with a different colour than the master line
		expect(colours[2]).not.toBe(colours[1]);
	});

	it('Should assign stable colours across re-renders', () => {
		const { graph } = renderedGraph();
		const first = graph.getVertexColours().slice();
		graph.render(null);
		expect(graph.getVertexColours()).toStrictEqual(first);
	});

	it('Should not crash when dropCommitPossible is called with an out-of-range index', () => {
		const { graph, commits } = renderedGraph();
		// Regression: an out-of-range index previously threw a TypeError
		expect(() => graph.dropCommitPossible(undefined)).not.toThrow();
		expect(graph.dropCommitPossible(-1)).toBe(false);
		expect(graph.dropCommitPossible(commits.length + 10)).toBe(false);
	});

	it('Should render without errors when extra row expansions are present', () => {
		const graph = createGraph();
		const commits = sampleCommits();
		const lookup: { [hash: string]: number } = {};
		commits.forEach((c, i) => lookup[c.hash] = i);
		graph.loadCommits(commits, 'dddddddddddddddddddddddddddddddddddddddd', lookup, false);
		// Row expansions (e.g. Gerrit meta rows) insert extra height after specific commits
		expect(() => graph.render(null, [{ index: 1, height: 20 }, { index: 3, height: 40 }])).not.toThrow();
	});
});


/* TextFormatter */

const formatter = (config?: { [key: string]: boolean }, commits: any[] = []) => new TextFormatter(commits, null, Object.assign({
	commits: false,
	emoji: false,
	issueLinking: false,
	markdown: false,
	multiline: false,
	urls: false
}, config));

describe('web/textFormatter.ts', () => {
	it('Should escape HTML characters in commit messages (XSS regression)', () => {
		const result = formatter().format('<img src=x onerror=alert(1)> & "quotes"');
		expect(result).not.toContain('<img');
		expect(result).toContain('&lt;img src=x onerror=alert(1)&gt;');
	});

	it('Should format known commit hashes as internal links', () => {
		const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
		const result = formatter({ commits: true }, [commit(hash, [], 'the referenced commit')]).format('fixed in ' + hash);
		expect(result).toContain('internalUrl');
		expect(result).toContain('data-type="commit"');
		expect(result).toContain('data-value="' + hash + '"');
	});

	it('Should leave unknown commit hashes unformatted', () => {
		const result = formatter({ commits: true }).format('fixed in a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
		expect(result).not.toContain('internalUrl');
	});

	it('Should format URLs as external links', () => {
		const result = formatter({ urls: true }).format('see https://example.com/page for details');
		// Forward slashes are HTML-escaped in the generated markup
		expect(result).toContain('href="https:&#x2F;&#x2F;example.com&#x2F;page"');
		expect(result).toContain('externalUrl');
	});

	it('Should format markdown emphasis', () => {
		const result = formatter({ markdown: true }).format('**bold** and _italic_ and `code`');
		expect(result).toContain('<strong>bold</strong>');
		expect(result).toContain('<em>italic</em>');
		expect(result).toContain('<code>code</code>');
	});

	it('Should replace known emoji shortcodes when emoji are enabled', () => {
		const result = formatter({ emoji: true }).format('ship it :rocket:');
		expect(result).toContain('🚀');
		expect(result).not.toContain(':rocket:');
	});

	it('Should leave unknown emoji shortcodes untouched', () => {
		const result = formatter({ emoji: true }).format('unknown :not_an_emoji:');
		expect(result).toContain(':not_an_emoji:');
	});

	it('Should escape HTML in custom emoji mapping payloads (self-XSS regression)', () => {
		TextFormatter.registerCustomEmojiMappings([
			{ shortcode: ':evil:', emoji: '<script>alert(1)</script>' },
			{ shortcode: ':ok:', emoji: ' ✔️ ' },
			{ shortcode: ':toolong:', emoji: 'x'.repeat(20) }, // exceeds the length cap: ignored
			{ shortcode: 'invalid', emoji: 'y' } // invalid shortcode: ignored
		]);
		const result = formatter({ emoji: true }).format('evil :evil: ok :ok: toolong :toolong:');
		expect(result).not.toContain('<script>');
		expect(result).toContain('✔️');
		expect(result).toContain(':toolong:');
	});
});
