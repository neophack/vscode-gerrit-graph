import { createHash } from 'crypto';
import { ErrorInfo, GerritChangeEvent, GerritChangeState, GerritChangeStatus, GerritPatchsetsMode } from './types';

/**
 * A minimal structural interface for running Git commands (implemented by `DataSource`).
 */
export interface GitRunner {
	gitOutput: <T>(args: string[], repo: string, resolveValue: { (stdout: string): T }) => Promise<T>;
	runGitCommand: (args: string[], repo: string) => Promise<ErrorInfo>;
}

export interface ParsedChangeRef {
	change: number;
	patchset?: number; // undefined => meta ref
	meta: boolean;
}

const CHANGE_REF_REGEX = /(?:^|\/)changes\/\d+\/(\d+)\/(meta|\d+)$/;
const CHANGE_ID_REGEX = /^Change-Id: (I[0-9a-f]{40})\s*$/m;
const LABEL_FOOTER_REGEX = /^Label: ([A-Za-z0-9-]+)\s*=\s*([+-]?\d+)\s*$/gm;
// "Change has been successfully merged by <name>" / "cherry-picked as <hash> by <name>" - the
// submitter's name follows "by" (optionally after a "as <hash>" re-submit hash), with or without
// a trailing "<email>"
const MERGED_BY_REGEX = /^Change has been successfully (?:merged|cherry-picked|pushed)(?:\s+as\s+[0-9a-f]{4,40})?\s+by\s+(.+?)(?:\s*<[^>]*>)?\s*$/;

/**
 * Parse a Gerrit change reference (either a remote change ref such as
 * `refs/changes/24/41466/1` or `refs/remotes/origin/changes/24/41466/1`,
 * or a NoteDb meta ref such as `refs/changes/24/41466/meta`).
 * @param ref The reference to parse.
 * @returns The parsed change ref, or NULL if the reference isn't a change ref.
 */
export function parseChangeRef(ref: string): ParsedChangeRef | null {
	const match = CHANGE_REF_REGEX.exec(ref);
	if (match === null) return null;
	const change = parseInt(match[1], 10);
	if (!isFinite(change) || change <= 0) return null;
	return match[2] === 'meta'
		? { change: change, meta: true }
		: { change: change, patchset: parseInt(match[2], 10), meta: false };
}

/**
 * Get the two digit shard of a change number (e.g. 41466 -> "66", 5 -> "05").
 */
export function changeShard(change: number) {
	return ('0' + (change % 100)).slice(-2);
}

/**
 * Parse the output of `git ls-remote <remote> 'refs/changes/*'` into a map of change number -> patchset numbers.
 * @param output The ls-remote output.
 * @returns The map of changes to their patchsets.
 */
export function parseLsRemoteChanges(output: string) {
	const changes = new Map<number, number[]>();
	for (const line of output.split(/\r?\n/)) {
		const parts = line.split(/[ \t]/);
		if (parts.length < 2) continue;
		const parsed = parseChangeRef(parts[1]);
		if (parsed === null || parsed.meta || parsed.patchset === undefined) continue;
		const patchsets = changes.get(parsed.change);
		if (patchsets === undefined) {
			changes.set(parsed.change, [parsed.patchset]);
		} else if (!patchsets.includes(parsed.patchset)) {
			patchsets.push(parsed.patchset);
		}
	}
	for (const patchsets of changes.values()) patchsets.sort((a, b) => a - b);
	return changes;
}

/**
 * Select the changes to fetch, keeping only the latest `limit` changes (by change number).
 * @param changes The map of changes to their patchsets.
 * @param limit The maximum number of changes to keep (<= 0 => keep all).
 */
export function limitChanges(changes: Map<number, number[]>, limit: number) {
	if (limit <= 0 || changes.size <= limit) return changes;
	const numbers = Array.from(changes.keys()).sort((a, b) => b - a).slice(0, limit);
	const limited = new Map<number, number[]>();
	for (const change of numbers) limited.set(change, changes.get(change)!);
	return limited;
}

/**
 * Normalise a user-provided change cache limit (the number of refs to cache) to a positive integer.
 * @param value The raw value (e.g. from a settings form input).
 * @returns The normalised limit (1..10000), or NULL if the value is invalid.
 */
export function normalizeGerritFetchLimit(value: unknown) {
	let limit: number;
	if (typeof value === 'number') {
		limit = value;
	} else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
		limit = parseInt(value.trim(), 10);
	} else {
		return null;
	}
	if (!isFinite(limit) || Math.floor(limit) !== limit) return null;
	if (limit < 1 || limit > 10000) return null;
	return limit;
}

/**
 * Build the fetch refspecs for a set of changes (including their NoteDb meta refs).
 * @param changes The map of changes to their patchsets.
 * @param remote The remote to fetch from.
 * @param patchsetMode Should all patchsets be fetched, or only the latest per change.
 * @returns The array of refspecs.
 */
export function buildFetchRefspecs(changes: Map<number, number[]>, remote: string, patchsetMode: GerritPatchsetsMode) {
	const refspecs: string[] = [];
	for (const [change, patchsets] of changes) {
		const shard = changeShard(change);
		const keep = patchsetMode === 'all' ? patchsets : [patchsets[patchsets.length - 1]];
		for (const patchset of keep) {
			refspecs.push('+refs/changes/' + shard + '/' + change + '/' + patchset + ':refs/remotes/' + remote + '/changes/' + shard + '/' + change + '/' + patchset);
		}
		refspecs.push('+refs/changes/' + shard + '/' + change + '/meta:refs/remotes/' + remote + '/changes/' + shard + '/' + change + '/meta');
	}
	return refspecs;
}

/**
 * Compute the local refs (under `refs/remotes/<remote>/changes/`) that should be kept for a set of changes.
 */
export function buildKeepPatterns(changes: Map<number, number[]>, remote: string) {
	const patterns: string[] = [];
	for (const change of changes.keys()) {
		patterns.push('refs/remotes/' + remote + '/changes/' + changeShard(change) + '/' + change + '/');
	}
	return patterns;
}

/* NoteDb Meta Parsing */

export interface MetaCommitRecord {
	/** the Gerrit user that performed the action (e.g. "Gerrit User 1000018") */
	committer: string;
	/** the commit timestamp (unix seconds) */
	timestamp: number;
	/** the full commit message */
	message: string;
}

interface ParsedMetaCommit {
	event: GerritChangeEvent;
	patchset: number;
	status: GerritChangeStatus | null;
	wip: boolean | null;
	commitHash: string | null;
}

/**
 * Parse a single NoteDb meta commit message into an event + state fields.
 * @param record The meta commit record.
 * @returns The parsed commit, or NULL if the message isn't a recognised review event.
 */
export function parseMetaCommit(record: MetaCommitRecord): ParsedMetaCommit | null {
	const message = record.message;
	const header = (message.split(/\r?\n/, 1)[0] || '').trim();
	const lines = message.split(/\r?\n/);

	const result: ParsedMetaCommit = {
		event: { type: 'comment', patchset: 0, timestamp: record.timestamp, raw: header, rawFull: message },
		patchset: 0,
		status: null,
		wip: null,
		commitHash: null
	};
	const event = result.event;
	event.reviewer = record.committer;

	// Footer fields (NoteDb metas use "Key: value" lines, often in a trailer block)
	for (const line of lines) {
		let match = /^Patch-set:\s*(\d+)\s*$/.exec(line.trim());
		if (match !== null) result.patchset = parseInt(match[1], 10);
		match = /^Status:\s*(new|merged|abandoned)\s*$/.exec(line.trim());
		if (match !== null) result.status = <GerritChangeStatus>match[1];
		match = /^Commit:\s*([0-9a-f]{4,40})\s*$/.exec(line.trim());
		if (match !== null) result.commitHash = match[1];
		match = /^Work-in-progress:\s*(true|false)\s*$/.exec(line.trim());
		if (match !== null) result.wip = match[1] === 'true';
	}

	let headerPatchset: number | null = null;
	let hm = /^Uploaded patch set (\d+)\./.exec(header);
	if (hm !== null) headerPatchset = parseInt(hm[1], 10);
	hm = /^Patch Set (\d+):/.exec(header);
	if (hm !== null) headerPatchset = parseInt(hm[1], 10);
	if (headerPatchset !== null) result.patchset = headerPatchset;

	// Submit events: Gerrit writes "Change has been successfully merged by <name>" into the BODY of
	// the meta commit (its subject is usually just "Update patch set N"), so scan every line for it
	let mergedBy: string | null = null;
	for (const line of lines) {
		const match = MERGED_BY_REGEX.exec(line.trim());
		if (match !== null) {
			mergedBy = match[1].trim();
			break;
		}
	}

	// Labels (votes): "Label: Code-Review=+2" footers, and/or "Patch Set N: Code-Review+2" headers
	const labels: { name: string; value: number }[] = [];
	let m: RegExpExecArray | null;
	const labelFooter = new RegExp(LABEL_FOOTER_REGEX.source, 'gm');
	while ((m = labelFooter.exec(message)) !== null) {
		labels.push({ name: m[1], value: parseInt(m[2], 10) });
	}
	const headerVote = /^Patch Set \d+:.*?\b([A-Za-z][A-Za-z0-9-]*)\s*([+-]\d)\b/.exec(header);
	if (headerVote !== null) {
		if (!labels.some((label) => label.name === headerVote![1])) {
			labels.push({ name: headerVote[1], value: parseInt(headerVote[2], 10) });
		}
	}

	if (labels.length > 0) {
		event.type = 'vote';
		event.labels = labels;
	} else if (/^Create change/.test(header)) {
		event.type = 'created';
		event.patchset = result.patchset = 1;
	} else if (/^Uploaded patch set \d+/.test(header)) {
		event.type = 'patchset';
	} else if (/^Change has been successfully (merged|cherry-picked|pushed)/.test(header) || result.status === 'merged') {
		event.type = 'merged';
		result.status = 'merged';
	} else if (/^Abandoned$/.test(header) || result.status === 'abandoned') {
		event.type = 'abandoned';
		result.status = 'abandoned';
	} else if (/^Restore(d| Ready for Review)?$/.test(header) || /^Restored$/.test(header) || (result.status === 'new' && /^Unabor/.test(header))) {
		event.type = 'restored';
		result.status = 'new';
	} else if (/Start Work In Progress|^Uploaded patch set \d+ \(WIP\)/.test(header) || result.wip === true) {
		event.type = 'wip';
		result.wip = true;
	} else if (/Restore Ready for Review|^Remove WIP|^Ready for review change/.test(header)) {
		event.type = 'ready';
		result.wip = false;
	} else if (/^Rebase/.test(header) || /^Patch Set \d+: Rebase/.test(header) || /^Uploaded patch set/.test(header)) {
		event.type = 'patchset';
	} else if (header === '' && lines.every((line) => /^[A-Za-z-]+:/.test(line.trim()))) {
		return null; // not a recognised review event
	}

	// Resolve the submitter of a merge: prefer the name from the "Change has been successfully ...
	// by <name>" line (usually in the body rather than the subject), then the "Submitted-by: Name <email>"
	// footer, and only then the (often anonymous) meta commit committer. Applies to vote commits that
	// Gerrit batched with the submit into a single meta commit as well, so they show the submitter.
	if (mergedBy !== null) {
		event.reviewer = mergedBy;
	} else if (event.type === 'merged') {
		const submittedBy = /^Submitted-by:\s*([^<]+?)(?:\s*<[^>]*>)?\s*$/m.exec(message);
		if (submittedBy !== null) event.reviewer = submittedBy[1].trim();
	}

	event.patchset = result.patchset;
	if (result.patchset === 0) return null;
	return result;
}

/**
 * Parse the full NoteDb meta history of a change into its state.
 * @param change The change number.
 * @param records The meta commit records, newest first (as outputted by `git log`).
 * @returns The change state, or NULL if no records exist.
 */
export function parseMetaHistory(change: number, records: MetaCommitRecord[]): GerritChangeState | null {
	if (records.length === 0) return null;

	const events: GerritChangeEvent[] = [];
	let status: GerritChangeStatus = 'new';
	let wip = false;
	let latestPatchset = 0;
	let headHash: string | null = null;
	let statusDetermined = false, wipDetermined = false;
	const crVotes: GerritChangeEvent[] = [];
	const vVotes: GerritChangeEvent[] = [];

	for (const record of records) {
		const parsed = parseMetaCommit(record);
		if (parsed === null) continue;

		events.push(parsed.event);
		if (parsed.patchset > latestPatchset) latestPatchset = parsed.patchset;
		// Records are iterated newest first: the first (i.e. most recent) status/wip transition wins
		if (parsed.status !== null && !statusDetermined) {
			status = parsed.status;
			statusDetermined = true;
		}
		if (parsed.wip !== null && !wipDetermined) {
			wip = parsed.wip;
			wipDetermined = true;
		}
		// The head hash of the latest patchset is the `Commit:` of the newest commit referencing it
		if (parsed.commitHash !== null && parsed.patchset === latestPatchset && headHash === null) {
			headHash = parsed.commitHash;
		}
		if (parsed.event.type === 'vote' && parsed.event.labels !== undefined) {
			for (const label of parsed.event.labels) {
				if (label.name === 'Code-Review') crVotes.push(parsed.event);
				else if (label.name === 'Verified') vVotes.push(parsed.event);
			}
		}
	}

	if (headHash === null) {
		// Fall back to any commit hash found in the history
		for (const record of records) {
			const match = /^Commit:\s*([0-9a-f]{4,40})\s*$/m.exec(record.message);
			if (match !== null) { headHash = match[1]; break; }
		}
		if (headHash === null) return null;
	}

	return {
		change: change,
		patchset: latestPatchset,
		codeReview: strongestVote(crVotes, 'Code-Review'),
		verified: strongestVote(vVotes, 'Verified'),
		status: status,
		wip: wip,
		headHash: headHash,
		events: events,
		url: null
	};
}

/**
 * Get the strongest vote for a label: the value with the greatest absolute value (ties broken by recency).
 */
function strongestVote(events: GerritChangeEvent[], label: string) {
	let best = 0;
	for (const event of events) { // events are newest first
		const vote = event.labels!.find((l) => l.name === label);
		if (vote === undefined) continue;
		if (Math.abs(vote.value) > Math.abs(best)) best = vote.value;
	}
	return best;
}

/* Change-Id Helpers */

/**
 * Extract the Gerrit Change-Id footer of a commit message.
 * @param message The commit message.
 * @returns The Change-Id (e.g. "I0123456789abcdef..."), or NULL if the message has no valid footer.
 */
export function extractChangeId(message: string) {
	const match = CHANGE_ID_REGEX.exec(message);
	return match === null ? null : match[1];
}

/**
 * Check if a commit message already contains a valid Change-Id footer.
 */
export function hasChangeId(message: string) {
	return extractChangeId(message) !== null;
}

/**
 * Generate a Gerrit Change-Id for a commit (same construction as the Gerrit commit-msg hook).
 * @param tree The tree hash of the commit.
 * @param parent The parent hash of the commit.
 * @param author The author string ("Name <email> timestamp").
 * @param committer The committer string ("Name <email> timestamp").
 * @param message The commit message (without Change-Id).
 * @param nonce An optional nonce (defaults to the current time in milliseconds).
 */
export function generateChangeId(tree: string, parent: string, author: string, committer: string, message: string, nonce: string = String(Date.now())) {
	const data = ['tree ' + tree, 'parent ' + parent, 'author ' + author, 'committer ' + committer, '', message, '', nonce, ''].join('\n');
	return 'I' + createHash('sha1').update(data).digest('hex');
}

/* Status Filtering */

/**
 * Filter change states by the status filter.
 * @param states The change states.
 * @param filter The status filter.
 * @returns The states that pass the filter.
 */
export function filterChangeStates(states: GerritChangeState[], filter: { new: boolean; merged: boolean; abandoned: boolean; wip: boolean }) {
	return states.filter((state) => {
		if (state.wip) return filter.wip;
		return filter[state.status];
	});
}


/**
 * Provides Gerrit integration data (change refs + NoteDb meta refs), all obtained via the Git protocol.
 */
export class GerritDataSource {
	private readonly git: GitRunner;
	private readonly metaCache = new Map<string, GerritChangeState>(); // key = <repo>|<metaRef>

	constructor(git: GitRunner) {
		this.git = git;
	}

	/**
	 * List the open change refs on a remote (without fetching any objects).
	 */
	public listRemoteChanges(repo: string, remote: string) {
		return this.git.gitOutput(['ls-remote', remote, 'refs/changes/*'], repo, (stdout) => parseLsRemoteChanges(stdout)).catch(() => new Map<number, number[]>());
	}

	/**
	 * Fetch the specified change refspecs from a remote into `refs/remotes/<remote>/changes/`.
	 */
	public fetchChanges(repo: string, remote: string, refspecs: string[]) {
		if (refspecs.length === 0) return Promise.resolve(null);
		return this.git.runGitCommand(['fetch', '--no-tags', remote].concat(refspecs), repo);
	}

	/**
	 * List the local change refs (under `refs/remotes/<remote>/changes/`) of a repository.
	 */
	public listLocalChangeRefs(repo: string, remote: string) {
		return this.git.gitOutput(['for-each-ref', 'refs/remotes/' + remote + '/changes/', '--format=%(refname)'], repo, (stdout) =>
			stdout.split(/\r?\n/).map((ref) => ref.trim()).filter((ref) => ref !== '')
		).catch(() => <string[]>[]);
	}

	/**
	 * Delete local change refs of changes that aren't in the keep list (keeps the repository at a constant size).
	 */
	public async pruneLocalChanges(repo: string, remote: string, keepChanges: ReadonlyArray<number>) {
		const prefixes = keepChanges.map((change) => 'refs/remotes/' + remote + '/changes/' + changeShard(change) + '/' + change + '/');
		const refs = await this.listLocalChangeRefs(repo, remote);
		for (const ref of refs) {
			if (!prefixes.some((prefix) => ref.startsWith(prefix))) {
				await this.git.runGitCommand(['update-ref', '-d', ref], repo);
			}
		}
	}

	/**
	 * Delete ALL local change refs (under `refs/remotes/<remote>/changes/`) of a repository.
	 * @returns The number of refs deleted, and the ErrorInfo of the first failed deletion (NULL => all succeeded).
	 */
	public async clearLocalChanges(repo: string, remote: string): Promise<{ error: ErrorInfo; cleared: number }> {
		const refs = await this.listLocalChangeRefs(repo, remote);
		let error: ErrorInfo = null, cleared = 0;
		for (const ref of refs) {
			const deleteError = await this.git.runGitCommand(['update-ref', '-d', ref], repo);
			if (deleteError === null) cleared++;
			else if (error === null) error = deleteError;
		}
		return { error: error, cleared: cleared };
	}

	/**
	 * Parse the NoteDb meta ref of a change into its state (cached by the meta ref's hash).
	 * @param repo The repository.
	 * @param remote The remote the change was fetched from.
	 * @param change The change number.
	 * @param urlBase The base URL of the Gerrit instance (or NULL).
	 */
	public async parseMeta(repo: string, remote: string, change: number, urlBase: string | null) {
		const metaRef = 'refs/remotes/' + remote + '/changes/' + changeShard(change) + '/' + change + '/meta';
		let hash: string;
		try {
			hash = await this.git.gitOutput(['rev-parse', metaRef], repo, (stdout) => stdout.trim());
		} catch (_) {
			return null; // meta ref not available locally
		}
		const cacheKey = repo + '|' + metaRef + '|' + hash;
		const cached = this.metaCache.get(cacheKey);
		if (cached !== undefined) return cached;

		const state = await this.git.gitOutput(
			['log', metaRef, '--format=' + ['%cN', '%ct', '%B'].join('%x1f') + '%x1e'],
			repo,
			(stdout) => {
				const records: MetaCommitRecord[] = [];
				for (const record of stdout.split('\x1e')) {
					const parts = record.split('\x1f');
					if (parts.length < 3) continue;
					records.push({ committer: parts[0].trim(), timestamp: parseInt(parts[1], 10), message: parts.slice(2).join('\x1f') });
				}
				return parseMetaHistory(change, records);
			}
		).catch(() => null);

		if (state === null) return null;
		state.url = urlBase !== null ? urlBase + change : null;
		this.metaCache.set(cacheKey, state);
		return state;
	}

	/**
	 * Derive the web URL of a Gerrit change from the remote's URL.
	 * @returns The base URL (ending with "/c/<project>/+/"), or NULL if the remote URL isn't an HTTP(S) URL.
	 */
	public getChangeUrlBase(repo: string, remote: string) {
		return this.git.gitOutput(['remote', 'get-url', remote], repo, (stdout) => {
			let url = stdout.trim();
			const sshMatch = /^(?:ssh:\/\/)?([^\/:]+)(?::29418)?\/(.+?)(?:\.git)?$/i.exec(url);
			if (sshMatch !== null) url = 'http://' + sshMatch[1] + '/' + sshMatch[2].replace(/^\//, '');
			if (!/^https?:\/\//i.test(url)) return null;
			const match = /^(https?:\/\/[^\/]+)\/?(.+?)(?:\.git)?\/?$/i.exec(url);
			if (match === null) return null;
			return match[1] + '/c/' + match[2] + '/+/';
		}).catch(() => null);
	}
}
