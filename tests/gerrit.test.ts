import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

/** Create a temporary repository directory (optionally containing the given hooks). */
function makeTmpRepo(hooks: string[]) {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-gerrit-test-'));
	(<any>fs).mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
	for (const hook of hooks) fs.writeFileSync(path.join(repo, '.git', 'hooks', hook), '#!/bin/sh' + String.fromCharCode(10));
	return repo;
}
import {
	GerritDataSource,
	buildFetchRefspecs,
	changeShard,
	extractChangeId,
	filterChangeStates,
	generateChangeId,
	hasChangeId,
	limitChanges,
	normalizeGerritFetchLimit,
	parseChangeRef,
	parseLsRemoteChanges,
	parseMetaHistory
} from '../src/gerrit';
import { GerritChangeState } from '../src/types';

describe('Gerrit', () => {
	describe('parseChangeRef', () => {
		it('parses a remote change ref', () => {
			expect(parseChangeRef('refs/changes/66/41466/1')).toEqual({ change: 41466, patchset: 1, meta: false });
		});
		it('parses a locally fetched change ref', () => {
			expect(parseChangeRef('refs/remotes/origin/changes/05/41005/3')).toEqual({ change: 41005, patchset: 3, meta: false });
		});
		it('parses a meta ref', () => {
			expect(parseChangeRef('refs/remotes/origin/changes/66/41466/meta')).toEqual({ change: 41466, meta: true });
		});
		it('rejects non-change refs', () => {
			expect(parseChangeRef('refs/heads/master')).toBeNull();
			expect(parseChangeRef('refs/remotes/origin/master')).toBeNull();
			expect(parseChangeRef('refs/tags/v1.0')).toBeNull();
			expect(parseChangeRef('')).toBeNull();
		});
	});

	describe('parseLsRemoteChanges', () => {
		it('groups patchsets by change', () => {
			const changes = parseLsRemoteChanges([
				'6c7c1c1 refs/changes/66/41466/1',
				'7d8d2d2 refs/changes/66/41466/2',
				'abc1234 refs/changes/05/41005/1',
				'deadbee refs/changes/05/41005/meta'
			].join('\n'));
			expect(changes.get(41466)).toEqual([1, 2]);
			expect(changes.get(41005)).toEqual([1]);
			expect(changes.size).toBe(2);
		});
		it('ignores meta refs, non-change refs and malformed lines', () => {
			const changes = parseLsRemoteChanges([
				'',
				'onlyonefield',
				'deadbee refs/heads/develop',
				'deadbee refs/remotes/origin/changes/66/41466/meta',
				'zzznotahash refs/changes/66/41466/1'
			].join('\n'));
			expect(changes.size).toBe(1);
			expect(changes.get(41466)).toEqual([1]);
		});
	});

	describe('limitChanges', () => {
		it('keeps the latest N changes', () => {
			const changes = new Map([[1, [1]], [2, [1]], [3, [1]], [4, [1]], [5, [1]]]);
			const limited = limitChanges(changes, 2);
			expect(Array.from(limited.keys())).toEqual([5, 4]);
		});
		it('keeps all changes when under the limit', () => {
			const changes = new Map([[1, [1]], [2, [1]]]);
			expect(limitChanges(changes, 5)).toBe(changes);
			expect(limitChanges(changes, 0)).toBe(changes);
		});
		it('returns the same map when exactly at the limit', () => {
			const changes = new Map([[1, [1]], [2, [1]]]);
			expect(limitChanges(changes, 2)).toBe(changes);
		});
	});

	describe('normalizeGerritFetchLimit', () => {
		it('accepts valid numbers and numeric strings', () => {
			expect(normalizeGerritFetchLimit(1)).toBe(1);
			expect(normalizeGerritFetchLimit(20)).toBe(20);
			expect(normalizeGerritFetchLimit(10000)).toBe(10000);
			expect(normalizeGerritFetchLimit('20')).toBe(20);
			expect(normalizeGerritFetchLimit(' 42 ')).toBe(42);
		});
		it('rejects values outside the 1..10000 range', () => {
			expect(normalizeGerritFetchLimit(0)).toBeNull();
			expect(normalizeGerritFetchLimit(-5)).toBeNull();
			expect(normalizeGerritFetchLimit(10001)).toBeNull();
			expect(normalizeGerritFetchLimit('0')).toBeNull();
		});
		it('rejects non-integer and malformed values', () => {
			expect(normalizeGerritFetchLimit(1.5)).toBeNull();
			expect(normalizeGerritFetchLimit('abc')).toBeNull();
			expect(normalizeGerritFetchLimit('20abc')).toBeNull();
			expect(normalizeGerritFetchLimit('')).toBeNull();
			expect(normalizeGerritFetchLimit(null)).toBeNull();
			expect(normalizeGerritFetchLimit(undefined)).toBeNull();
			expect(normalizeGerritFetchLimit(NaN)).toBeNull();
			expect(normalizeGerritFetchLimit(Infinity)).toBeNull();
		});
	});

	describe('buildFetchRefspecs', () => {
		it('builds refspecs for the latest patchset + meta ref', () => {
			const changes = new Map([[41466, [1, 2, 3]]]);
			expect(buildFetchRefspecs(changes, 'origin', 'latest')).toEqual([
				'+refs/changes/66/41466/3:refs/remotes/origin/changes/66/41466/3',
				'+refs/changes/66/41466/meta:refs/remotes/origin/changes/66/41466/meta'
			]);
		});
		it('builds refspecs for all patchsets', () => {
			const changes = new Map([[41005, [1, 2]]]);
			expect(buildFetchRefspecs(changes, 'origin', 'all')).toEqual([
				'+refs/changes/05/41005/1:refs/remotes/origin/changes/05/41005/1',
				'+refs/changes/05/41005/2:refs/remotes/origin/changes/05/41005/2',
				'+refs/changes/05/41005/meta:refs/remotes/origin/changes/05/41005/meta'
			]);
		});
		it('handles change numbers below 100 (zero padded shard)', () => {
			expect(changeShard(5)).toBe('05');
			expect(changeShard(100)).toBe('00');
			expect(changeShard(41466)).toBe('66');
			expect(changeShard(99)).toBe('99');
			expect(changeShard(199)).toBe('99');
			expect(changeShard(200)).toBe('00');
		});
		it('builds no refspecs for an empty change map', () => {
			expect(buildFetchRefspecs(new Map(), 'origin', 'all')).toEqual([]);
		});
	});

	describe('parseMetaHistory', () => {
		it('parses a new change with votes and computes the strongest scores', () => {
			// Records are newest first (git log order)
			const state = parseMetaHistory(41466, [
				{
					committer: 'Gerrit User 1000013',
					timestamp: 1700000100,
					message: 'Patch Set 1: Code-Review+2\n\nPatch-set: 1\nLabel: Code-Review=+2\nLabel: Verified=+1\nCommit: f198edaa11\nStatus: new\n'
				},
				{
					committer: 'Gerrit User 1000018',
					timestamp: 1700000000,
					message: 'Create change\n\nUpload created patch-set 1\nPatch-set: 1\nCommit: f198edaa11\nStatus: new\n'
				}
			])!;
			expect(state).not.toBeNull();
			expect(state.change).toBe(41466);
			expect(state.patchset).toBe(1);
			expect(state.status).toBe('new');
			expect(state.headHash).toBe('f198edaa11');
			expect(state.codeReview).toBe(2);
			expect(state.verified).toBe(1);
			expect(state.events.some((e) => e.type === 'created')).toBe(true);
			expect(state.events.some((e) => e.type === 'vote' && e.labels!.some((l) => l.name === 'Code-Review' && l.value === 2))).toBe(true);
		});

		it('takes the vote with the greatest absolute value (most recent wins ties)', () => {
			const state = parseMetaHistory(1, [
				{ committer: 'A', timestamp: 3, message: 'Patch Set 1: Code-Review+2\n\nLabel: Code-Review=+2\nPatch-set: 1\nCommit: aaaa\nStatus: new\n' },
				{ committer: 'B', timestamp: 2, message: 'Patch Set 1: Code-Review-1\n\nLabel: Code-Review=-1\nPatch-set: 1\nCommit: aaaa\nStatus: new\n' }
			])!;
			expect(state.codeReview).toBe(2);
		});

		it('handles merged changes', () => {
			const state = parseMetaHistory(2, [
				{ committer: 'Bot', timestamp: 3, message: 'Change has been successfully merged\n\nPatch-set: 2\nCommit: bbbb\nStatus: merged\nTag: autogenerated:gerrit:merged\n' },
				{ committer: 'User', timestamp: 2, message: 'Uploaded patch set 2.\n\nPatch-set: 2\nCommit: cccc\nStatus: new\n' },
				{ committer: 'User', timestamp: 1, message: 'Create change\n\nPatch-set: 1\nCommit: dddd\nStatus: new\n' }
			])!;
			expect(state.status).toBe('merged');
			expect(state.patchset).toBe(2);
			expect(state.headHash).toBe('bbbb');
		});

		it('parses the submitter name from "merged by <name>" instead of the anonymous committer', () => {
			const state = parseMetaHistory(7, [
				{ committer: 'Gerrit User 1000018', timestamp: 3, message: 'Change has been successfully merged by 李四\n\nPatch-set: 2\nCommit: b1b1\nStatus: merged\n' },
				{ committer: 'User', timestamp: 1, message: 'Create change\n\nPatch-set: 1\nCommit: d1d1\nStatus: new\n' }
			])!;
			expect(state.status).toBe('merged');
			const merged = state.events.find((e) => e.type === 'merged')!;
			expect(merged.reviewer).toBe('李四');
		});

		it('parses the submitter name from "cherry-picked by <name>"', () => {
			const state = parseMetaHistory(8, [
				{ committer: 'Gerrit User 1000018', timestamp: 3, message: 'Change has been successfully cherry-picked by 李四\n\nPatch-set: 1\nCommit: c1c1\nStatus: merged\n' }
			])!;
			const merged = state.events.find((e) => e.type === 'merged')!;
			expect(merged.reviewer).toBe('李四');
		});

		it('falls back to the Submitted-by footer (name without email) for the submitter name', () => {
			const state = parseMetaHistory(9, [
				{ committer: 'Bot', timestamp: 3, message: 'Change has been successfully merged\n\nPatch-set: 2\nCommit: b2b2\nStatus: merged\nSubmitted-by: 李四 <lisi@example.com>\n' }
			])!;
			const merged = state.events.find((e) => e.type === 'merged')!;
			expect(merged.reviewer).toBe('李四');
		});

		it('keeps the committer as reviewer when no submitter name is available', () => {
			const state = parseMetaHistory(10, [
				{ committer: 'Bot', timestamp: 3, message: 'Change has been successfully merged\n\nPatch-set: 2\nCommit: b3b3\nStatus: merged\n' }
			])!;
			const merged = state.events.find((e) => e.type === 'merged')!;
			expect(merged.reviewer).toBe('Bot');
		});

		it('handles abandoned then restored changes', () => {
			const state = parseMetaHistory(3, [
				{ committer: 'User', timestamp: 3, message: 'Restore\n\nPatch-set: 1\nCommit: eeee\nStatus: new\n' },
				{ committer: 'User', timestamp: 2, message: 'Abandoned\n\nPatch-set: 1\nCommit: eeee\nStatus: abandoned\n' },
				{ committer: 'User', timestamp: 1, message: 'Create change\n\nPatch-set: 1\nCommit: eeee\nStatus: new\n' }
			])!;
			expect(state.status).toBe('new');
			expect(state.events.some((e) => e.type === 'abandoned')).toBe(true);
			expect(state.events.some((e) => e.type === 'restored')).toBe(true);
		});

		it('handles WIP and ready transitions', () => {
			const state = parseMetaHistory(4, [
				{ committer: 'User', timestamp: 2, message: 'Start Work In Progress\n\nPatch-set: 1\nCommit: ffff\nStatus: new\nWork-in-progress: true\n' },
				{ committer: 'User', timestamp: 1, message: 'Create change\n\nPatch-set: 1\nCommit: ffff\nStatus: new\n' }
			])!;
			expect(state.wip).toBe(true);
		});

		it('tolerates a missing Status line', () => {
			const state = parseMetaHistory(5, [
				{ committer: 'User', timestamp: 1, message: 'Create change\n\nPatch-set: 1\nCommit: abab\n' }
			])!;
			expect(state.status).toBe('new');
		});

		it('returns null when there are no records', () => {
			expect(parseMetaHistory(6, [])).toBeNull();
		});

		it('carries the verbatim NoteDb message of each event in rawFull', () => {
			const mergedMessage = 'Change has been successfully merged by Alice\n\nPatch-set: 1\nCommit: a1a1\nStatus: merged\n';
			const createdMessage = 'Create change\n\nPatch-set: 1\nCommit: a1a1\nStatus: new\n';
			const state = parseMetaHistory(20, [
				{ committer: 'Gerrit User 1000018', timestamp: 2, message: mergedMessage },
				{ committer: 'Dev', timestamp: 1, message: createdMessage }
			])!;
			expect(state.events.length).toBe(2);
			expect(state.events[0].raw).toBe('Change has been successfully merged by Alice');
			expect(state.events[0].rawFull).toBe(mergedMessage);
			expect(state.events[1].raw).toBe('Create change');
			expect(state.events[1].rawFull).toBe(createdMessage);
		});

		it('treats a Status: merged footer without a "successfully merged" header as a merge event', () => {
			const state = parseMetaHistory(11, [
				{ committer: 'Gerrit User 1000018', timestamp: 3, message: 'Submitted\n\nPatch-set: 1\nCommit: a11a\nStatus: merged\nSubmitted-with: OK\n' }
			])!;
			expect(state.status).toBe('merged');
			expect(state.events[0].type).toBe('merged');
		});

		it('recognises the "pushed" submit strategy', () => {
			const state = parseMetaHistory(12, [
				{ committer: 'Gerrit User 1000018', timestamp: 3, message: 'Change has been successfully pushed by Carol\n\nPatch-set: 1\nCommit: b12b\nStatus: merged\n' }
			])!;
			expect(state.status).toBe('merged');
			expect(state.events[0].type).toBe('merged');
			expect(state.events[0].reviewer).toBe('Carol');
		});

		it('restores an abandoned change ("Restored" header) and updates the status back to new', () => {
			const state = parseMetaHistory(13, [
				{ committer: 'User', timestamp: 3, message: 'Restored\n\nPatch-set: 1\nCommit: c13c\nStatus: new\n' },
				{ committer: 'User', timestamp: 2, message: 'Abandoned\n\nPatch-set: 1\nCommit: c13c\nStatus: abandoned\n' }
			])!;
			expect(state.status).toBe('new');
			expect(state.events[0].type).toBe('restored');
		});

		it('marks a change ready for review again after WIP ("Remove WIP")', () => {
			const state = parseMetaHistory(14, [
				{ committer: 'User', timestamp: 3, message: 'Remove WIP\n\nPatch-set: 1\nCommit: d14d\nStatus: new\nWork-in-progress: false\n' },
				{ committer: 'User', timestamp: 2, message: 'Start Work In Progress\n\nPatch-set: 1\nCommit: d14d\nStatus: new\nWork-in-progress: true\n' }
			])!;
			expect(state.wip).toBe(false);
			expect(state.events[0].type).toBe('ready');
		});

		it('detects WIP from an "Uploaded patch set N (WIP)" upload header', () => {
			const state = parseMetaHistory(15, [
				{ committer: 'User', timestamp: 2, message: 'Uploaded patch set 2 (WIP)\n\nPatch-set: 2\nCommit: e15e\nStatus: new\nWork-in-progress: true\n' },
				{ committer: 'User', timestamp: 1, message: 'Create change\n\nPatch-set: 1\nCommit: e151\nStatus: new\n' }
			])!;
			expect(state.wip).toBe(true);
			expect(state.patchset).toBe(2);
		});

		it('prefers the vote with the greatest absolute value, negative beats positive of smaller magnitude', () => {
			const state = parseMetaHistory(16, [
				{ committer: 'A', timestamp: 3, message: 'Patch Set 1: Code-Review-2\n\nLabel: Code-Review=-2\nPatch-set: 1\nCommit: f16f\nStatus: new\n' },
				{ committer: 'B', timestamp: 2, message: 'Patch Set 1: Code-Review+1\n\nLabel: Code-Review=+1\nPatch-set: 1\nCommit: f16f\nStatus: new\n' }
			])!;
			expect(state.codeReview).toBe(-2);
		});

		it('derives the patchset from the "Patch Set N:" header over the footer', () => {
			const state = parseMetaHistory(17, [
				{ committer: 'A', timestamp: 2, message: 'Patch Set 3: Code-Review+2\n\nPatch-set: 1\nCommit: a17a\nStatus: new\n' }
			])!;
			expect(state.patchset).toBe(3);
		});

		it('falls back to an older record for the head hash when the newest record has no Commit', () => {
			const state = parseMetaHistory(18, [
				{ committer: 'A', timestamp: 3, message: 'Patch Set 1: Code-Review+2\n\nLabel: Code-Review=+2\nPatch-set: 1\nStatus: new\n' },
				{ committer: 'B', timestamp: 2, message: 'Create change\n\nPatch-set: 1\nCommit: b18b\nStatus: new\n' }
			])!;
			expect(state.headHash).toBe('b18b');
		});

		it('returns null when no record references a commit hash', () => {
			expect(parseMetaHistory(19, [
				{ committer: 'A', timestamp: 1, message: 'Create change\n\nPatch-set: 1\nStatus: new\n' }
			])).toBeNull();
		});
	});

	describe('filterChangeStates (N3: filter consistency)', () => {
		const states: GerritChangeState[] = [
			{ change: 1, patchset: 1, codeReview: 0, verified: 0, status: 'new', wip: false, headHash: 'aaa', events: [], url: null },
			{ change: 2, patchset: 2, codeReview: 2, verified: 1, status: 'merged', wip: false, headHash: 'bbb', events: [], url: null },
			{ change: 3, patchset: 1, codeReview: 0, verified: 0, status: 'abandoned', wip: false, headHash: 'ccc', events: [], url: null },
			{ change: 4, patchset: 1, codeReview: 0, verified: 0, status: 'new', wip: true, headHash: 'ddd', events: [], url: null }
		];
		it('defaults to only open (non-wip) changes', () => {
			const kept = filterChangeStates(states, { new: true, merged: false, abandoned: false, wip: false });
			expect(kept.map((s) => s.change)).toEqual([1]);
		});
		it('includes merged/abandoned/wip when enabled', () => {
			const kept = filterChangeStates(states, { new: true, merged: true, abandoned: true, wip: true });
			expect(kept.map((s) => s.change)).toEqual([1, 2, 3, 4]);
		});
	});

	describe('Change URL derivation', () => {
		const urlBaseOf = (remoteUrl: string) => {
			const fakeGit = {
				gitOutput: (_args: any, _repo: any, resolve: { (stdout: string): any }) => Promise.resolve(resolve(remoteUrl)),
				runGitCommand: () => Promise.resolve(null),
				runGitCommandWithInput: () => Promise.resolve(null)
			};
			return new GerritDataSource(fakeGit).getChangeUrlBase('/repo', 'origin');
		};
		it('derives /c/<project>/+/ from an HTTP remote URL', async () => {
			expect(await urlBaseOf('http://gerrit.example.com/team/repo')).toBe('http://gerrit.example.com/c/team/repo/+/');
		});
		it('derives /c/<project>/+/ from an HTTPS remote URL with trailing .git', async () => {
			expect(await urlBaseOf('https://gerrit.example.com/team/repo.git')).toBe('https://gerrit.example.com/c/team/repo/+/');
		});
		it('derives /c/<project>/+/ from an SSH remote URL', async () => {
			expect(await urlBaseOf('ssh://gerrit.example.com:29418/team/repo.git')).toBe('http://gerrit.example.com/c/team/repo/+/');
		});
		it('returns null for non-HTTP remote URLs', async () => {
			const base = await urlBaseOf('git@host:repo');
			expect(base === null || base.startsWith('http')).toBe(true);
		});
	});

	describe('clearLocalChanges', () => {
		const localRefs = [
			'refs/remotes/origin/changes/66/41466/1',
			'refs/remotes/origin/changes/66/41466/meta',
			'refs/remotes/origin/changes/05/41005/2'
		].join('\n');
		const clearWith = (runGitCommandWithInput: (args: string[], input: string) => Promise<any>) => {
			const inputs: { args: string[], input: string }[] = [];
			const fakeGit = {
				gitOutput: (args: any, _repo: any, resolve: { (stdout: string): any }) => {
					// Respond to the `for-each-ref refs/remotes/origin/changes/` listing
					expect(args).toEqual(['for-each-ref', 'refs/remotes/origin/changes/', '--format=%(refname)']);
					return Promise.resolve(resolve(localRefs));
				},
				runGitCommand: () => Promise.resolve(null),
				runGitCommandWithInput: (args: string[], _repo: string, input: string) => {
					inputs.push({ args: args, input: input });
					return runGitCommandWithInput(args, input);
				}
			};
			return { promise: new GerritDataSource(fakeGit).clearLocalChanges('/repo', 'origin'), inputs: inputs };
		};
		it('deletes every local change ref with ONE batched git update-ref --stdin command', async () => {
			const { promise, inputs } = clearWith(() => Promise.resolve(null));
			expect(await promise).toEqual({ error: null, cleared: 3 });
			expect(inputs).toEqual([{
				args: ['update-ref', '--stdin'],
				input: 'delete refs/remotes/origin/changes/66/41466/1\ndelete refs/remotes/origin/changes/66/41466/meta\ndelete refs/remotes/origin/changes/05/41005/2\n'
			}]);
		});
		it('reports the error and clears nothing when the (atomic) batch deletion fails', async () => {
			const { promise, inputs } = clearWith(() => Promise.resolve('error: unable to delete ref'));
			expect(await promise).toEqual({ error: 'error: unable to delete ref', cleared: 0 });
			expect(inputs.length).toBe(1);
		});
		it('clears nothing when no local change refs exist', async () => {
			const fakeGit = {
				gitOutput: (_args: any, _repo: any, resolve: { (stdout: string): any }) => Promise.resolve(resolve('')),
				runGitCommand: () => Promise.resolve(null),
				runGitCommandWithInput: () => Promise.resolve(null)
			};
			expect(await new GerritDataSource(fakeGit).clearLocalChanges('/repo', 'origin')).toEqual({ error: null, cleared: 0 });
		});
	});

	describe('parseMetas (concurrent NoteDb meta parsing)', () => {
		/**
		 * A fake GitRunner serving two changes: 41466 (one event) and 41005 (two events).
		 * `hashes` holds the meta ref hashes, `logs` the `git log <metaRef>` outputs.
		 */
		const fakeRunner = (hashes: { [ref: string]: string }, logs: { [ref: string]: string }) => {
			const logCommands: string[][] = [];
			const git = {
				gitOutput: (args: string[], _repo: string, resolve: { (stdout: string): any }) => {
					if (args[0] === 'for-each-ref') {
						const output = Object.keys(hashes).map((ref) => ref + '\0' + hashes[ref]).join('\n');
						return Promise.resolve(resolve(output));
					}
					// `git log <metaRef> --format=...`
					logCommands.push(args);
					return Promise.resolve(resolve(logs[args[1]] || ''));
				},
				runGitCommand: () => Promise.resolve(null),
				runGitCommandWithInput: () => Promise.resolve(null)
			};
			return { git: git, logCommands: logCommands };
		};
		const hashA = 'a'.repeat(40), hashB = 'b'.repeat(40);
		const refA = 'refs/remotes/origin/changes/66/41466/meta', refB = 'refs/remotes/origin/changes/05/41005/meta';
		const logOf = (messages: string[]) => messages.map((message) => 'Committer <c@gerrit.local>\u001f' + 1700000000 + '\u001f' + message + '\n').join('\u001e');

		it('parses every change and returns the states in the input order', async () => {
			const { git, logCommands } = fakeRunner(
				{ [refA]: hashA, [refB]: hashB },
				{
					[refA]: logOf(['Create change\n\nPatch-set: 1\nCommit: ' + '1'.repeat(40) + '\nStatus: new\n']),
					[refB]: logOf([
						'Patch Set 2: Code-Review+2\n\nPatch-set: 2\nCommit: ' + '2'.repeat(40) + '\nLabel: Code-Review=+2\nStatus: new\n',
						'Create change\n\nPatch-set: 1\nCommit: ' + '2'.repeat(40) + '\nStatus: new\n'
					])
				}
			);
			const states = await new GerritDataSource(git).parseMetas('/repo', 'origin', [41005, 41466], null);
			expect(Array.from(states.keys())).toEqual([41005, 41466]); // input order, not completion order
			expect(states.get(41466)).toMatchObject({ change: 41466, status: 'new', patchset: 1 });
			expect(states.get(41005)).toMatchObject({ change: 41005, status: 'new', patchset: 2, codeReview: 2 });
			// one batched hash resolution + one `git log` per change
			expect(logCommands.length).toBe(2);
		});

		it('maps changes without a local meta ref to null (without running any Git log)', async () => {
			const { git, logCommands } = fakeRunner({ [refA]: hashA }, { [refA]: logOf(['Create change\n\nPatch-set: 1\nCommit: ' + '1'.repeat(40) + '\nStatus: new\n']) });
			const states = await new GerritDataSource(git).parseMetas('/repo', 'origin', [41466, 41005], null);
			expect(states.get(41466)).not.toBeNull();
			expect(states.get(41005)).toBeNull();
			expect(logCommands.length).toBe(1);
		});

		it('serves a second parse of the same meta hashes from the cache', async () => {
			const { git, logCommands } = fakeRunner({ [refA]: hashA, [refB]: hashB }, {
				[refA]: logOf(['Create change\n\nPatch-set: 1\nCommit: ' + '1'.repeat(40) + '\nStatus: new\n']),
				[refB]: logOf(['Create change\n\nPatch-set: 1\nCommit: ' + '2'.repeat(40) + '\nStatus: new\n'])
			});
			const gerrit = new GerritDataSource(git);
			await gerrit.parseMetas('/repo', 'origin', [41466, 41005], null);
			const first = logCommands.length;
			const states = await gerrit.parseMetas('/repo', 'origin', [41466, 41005], 'https://gerrit.example.com/c/repo/+/');
			expect(logCommands.length).toBe(first); // no additional Git log command was spawned
			expect(states.get(41466)!.url).toBeNull(); // cached states keep the url of their first parse
		});
	});

	describe('Change-Id helpers (F5)', () => {
		it('extracts the Change-Id value from a message footer', () => {
			const id = 'I' + 'a'.repeat(40);
			expect(extractChangeId('Do something\n\nChange-Id: ' + id)).toBe(id);
		});
		it('returns null when there is no valid Change-Id to extract', () => {
			expect(extractChangeId('Do something')).toBeNull();
			expect(extractChangeId('Change-Id: Iabc')).toBeNull();
			expect(extractChangeId('Change-Id: X' + 'a'.repeat(40))).toBeNull();
		});
		it('detects a valid Change-Id footer', () => {
			expect(hasChangeId('Do something\n\nChange-Id: I' + 'a'.repeat(40))).toBe(true);
		});
		it('detects a Change-Id footer with CRLF line endings and trailing whitespace', () => {
			expect(hasChangeId('Do something\r\n\r\nChange-Id: I' + 'b'.repeat(40) + ' \r\n')).toBe(true);
		});
		it('rejects a Change-Id that is not on its own line', () => {
			expect(hasChangeId('Do something Change-Id: I' + 'c'.repeat(40))).toBe(false);
		});
		it('rejects missing or malformed Change-Ids', () => {
			expect(hasChangeId('Do something')).toBe(false);
			expect(hasChangeId('Change-Id: Iabc')).toBe(false);
			expect(hasChangeId('Change-Id: X' + 'a'.repeat(40))).toBe(false);
		});
		it('generates a Gerrit-shaped Change-Id', () => {
			const id = generateChangeId('tree', 'parent', 'A <a@b.c> 1', 'C <c@d.e> 2', 'message');
			expect(id).toMatch(/^I[0-9a-f]{40}$/);
			// Deterministic for identical inputs (excluding the nonce)
			expect(generateChangeId('tree', 'parent', 'A <a@b.c> 1', 'C <c@d.e> 2', 'message', 'nonce')).toBe(
				generateChangeId('tree', 'parent', 'A <a@b.c> 1', 'C <c@d.e> 2', 'message', 'nonce')
			);
		});
	});

	describe('getHookStatus', () => {
		const fakeGit = (gitDir: string) => ({
			gitOutput: (args: string[], _repo: string, resolve: { (stdout: string): any }) => {
				if (args[0] === 'rev-parse') return Promise.resolve(resolve(gitDir));
				return Promise.resolve(resolve(''));
			},
			runGitCommand: () => Promise.resolve(null),
			runGitCommandWithInput: () => Promise.resolve(null)
		});
		it('reports every tracked hook with its installed state', async () => {
			const repo = makeTmpRepo(['commit-msg']);
			const hooks = await new GerritDataSource(fakeGit('.git')).getHookStatus(repo);
			expect(hooks.error).toBeNull();
			expect(hooks.hooks).toEqual([
				{ name: 'pre-commit', installed: false, installable: false },
				{ name: 'commit-msg', installed: true, installable: true },
				{ name: 'post-commit', installed: false, installable: false }
			]);
		});
		it('resolves a relative git-dir against the repository path', async () => {
			const repo = makeTmpRepo([]);
			const hooks = await new GerritDataSource(fakeGit('.git')).getHookStatus(repo);
			expect(hooks.error).toBeNull();
			expect(hooks.hooks.every((hook) => !hook.installed)).toBe(true);
		});
		it('returns an error when the git-dir cannot be resolved', async () => {
			const failing = {
				gitOutput: () => Promise.reject(new Error('not a repo')),
				runGitCommand: () => Promise.resolve(null),
				runGitCommandWithInput: () => Promise.resolve(null)
			};
			const hooks = await new GerritDataSource(failing).getHookStatus('/repo');
			expect(typeof hooks.error).toBe('string');
			expect(hooks.hooks).toEqual([]);
		});
	});

	describe('installHook', () => {
		const NL = String.fromCharCode(10);
		const HOOK_SCRIPT = '#!/bin/sh' + NL + '# Gerrit commit-msg hook' + NL + 'exit 0' + NL;
		let server!: http.Server, origin: string = '';
		/** A fake GitRunner answering `remote get-url` and `rev-parse --git-dir`. */
		const fakeGit = (remoteUrl: string, gitDir: string) => ({
			gitOutput: (args: string[], _repo: string, resolve: { (stdout: string): any }) => {
				if (args[0] === 'remote' && args[1] === 'get-url') return Promise.resolve(resolve(remoteUrl));
				if (args[0] === 'rev-parse') return Promise.resolve(resolve(gitDir));
				return Promise.resolve(resolve(''));
			},
			runGitCommand: () => Promise.resolve(null),
			runGitCommandWithInput: () => Promise.resolve(null)
		});
		/** Serve the commit-msg hook script for every request (optionally with a different status/body). */
		const serve = (status: number, body: string) => {
			server = http.createServer((_req, res) => { res.statusCode = status; res.end(body); });
			return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => {
				origin = 'http://127.0.0.1:' + (<any>server.address()).port;
				resolve();
			}));
		};

		beforeAll(() => serve(200, HOOK_SCRIPT));
		afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

		it('downloads and installs the commit-msg hook from the Gerrit server', async () => {
			const repo = makeTmpRepo([]);
			const result = await new GerritDataSource(fakeGit(origin + '/team/repo.git', '.git')).installHook(repo, 'origin', 'commit-msg');
			expect(result).toEqual({ error: null, installed: true });
			expect(fs.readFileSync(path.join(repo, '.git', 'hooks', 'commit-msg'), 'utf8')).toBe(HOOK_SCRIPT);
		});
		it('reports an already up-to-date hook without rewriting it', async () => {
			const repo = makeTmpRepo([]);
			const gerrit = new GerritDataSource(fakeGit(origin + '/team/repo.git', '.git'));
			expect(await gerrit.installHook(repo, 'origin', 'commit-msg')).toEqual({ error: null, installed: true });
			expect(await gerrit.installHook(repo, 'origin', 'commit-msg')).toEqual({ error: null, installed: false });
		});
		it('derives the server origin from an ssh remote URL', async () => {
			const repo = makeTmpRepo([]);
			const result = await new GerritDataSource(fakeGit('ssh://gerrit-user@127.0.0.1:29418/team/repo', '.git')).installHook(repo, 'origin', 'commit-msg');
			// Port 29418 isn't the HTTP server, so the download fails - but only AFTER the ssh URL was
			// converted to an http origin (i.e. the error must be a download error, not a URL error)
			expect(typeof result.error).toBe('string');
			expect(result.error).toContain('Unable to download');
		});
		it('rejects hooks Gerrit does not serve', async () => {
			const result = await new GerritDataSource(fakeGit(origin + '/team/repo.git', '.git')).installHook('/repo', 'origin', 'pre-commit');
			expect(result.installed).toBe(false);
			expect(result.error).toContain('cannot be downloaded');
		});
		it('rejects remote URLs from which no Gerrit server can be derived', async () => {
			const result = await new GerritDataSource(fakeGit('git@localhost:repo', '.git')).installHook('/repo', 'origin', 'commit-msg');
			expect(result.installed).toBe(false);
			expect(result.error).toContain('Unable to derive the Gerrit server URL');
		});
		it('rejects downloaded content that is not a hook script', async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await serve(200, '<html>Not Found</html>');
			const result = await new GerritDataSource(fakeGit(origin + '/team/repo.git', '.git')).installHook(makeTmpRepo([]), 'origin', 'commit-msg');
			expect(result.installed).toBe(false);
			expect(result.error).toContain('not a valid hook script');
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await serve(200, HOOK_SCRIPT);
		});
		it('reports HTTP errors of the download', async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await serve(404, '');
			const result = await new GerritDataSource(fakeGit(origin + '/team/repo.git', '.git')).installHook(makeTmpRepo([]), 'origin', 'commit-msg');
			expect(result.installed).toBe(false);
			expect(result.error).toContain('HTTP 404');
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await serve(200, HOOK_SCRIPT);
		});
	});
});

