/**
 * Security & robustness regression tests.
 *
 * Covers the input validation added to prevent argument injection into Git commands (values
 * received from the webview must never be interpretable as Git options), the shell quoting used
 * for commands sent to the integrated terminal, the encoding of JSON embedded in inline scripts,
 * and crash regressions (unhandled promise rejections / hangs).
 */
import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });
jest.mock('../src/askpass/askpassManager');
jest.mock('../src/logger');

import * as cp from 'child_process';
import { ConfigurationChangeEvent } from 'vscode';
import { DataSource } from '../src/dataSource';
import { GitPushBranchMode } from '../src/types';
import { Logger } from '../src/logger';
import * as utils from '../src/utils';
import { EventEmitter } from '../src/utils/event';
import { BufferedQueue } from '../src/utils/bufferedQueue';

import { mockSpyOnSpawn } from './mocks/spawn';

describe('Input validation (argument injection prevention)', () => {
	describe('isValidCommitHash', () => {
		it('Should accept full and abbreviated hexadecimal commit hashes', () => {
			expect(utils.isValidCommitHash('1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b')).toBe(true);
			expect(utils.isValidCommitHash('1a2b3c4')).toBe(true);
			expect(utils.isValidCommitHash('ABCDEF01')).toBe(true);
		});

		it('Should reject hashes that could be interpreted as Git options', () => {
			expect(utils.isValidCommitHash('--exec=calc')).toBe(false);
			expect(utils.isValidCommitHash('-')).toBe(false);
			expect(utils.isValidCommitHash('HEAD; rm -rf /')).toBe(false);
			expect(utils.isValidCommitHash('$(whoami)')).toBe(false);
			expect(utils.isValidCommitHash('')).toBe(false);
			expect(utils.isValidCommitHash('zzzzzzz')).toBe(false);
			expect(utils.isValidCommitHash(undefined as any)).toBe(false);
		});
	});

	describe('isSafeRefName', () => {
		it('Should accept valid branch, tag and remote names', () => {
			expect(utils.isSafeRefName('master')).toBe(true);
			expect(utils.isSafeRefName('feature/x')).toBe(true);
			expect(utils.isSafeRefName('remotes/origin/master')).toBe(true);
			expect(utils.isSafeRefName('HEAD')).toBe(true);
			expect(utils.isSafeRefName('release-1.0.0')).toBe(true);
		});

		it('Should reject names that could be interpreted as Git options or break the ref format', () => {
			expect(utils.isSafeRefName('--upload-pack=calc')).toBe(false); // option smuggling
			expect(utils.isSafeRefName('-b')).toBe(false); // leading dash
			expect(utils.isSafeRefName('.hidden')).toBe(false); // leading dot
			expect(utils.isSafeRefName('a..b')).toBe(false); // double dot
			expect(utils.isSafeRefName('a@{b')).toBe(false); // reflog syntax
			expect(utils.isSafeRefName('a:b')).toBe(false); // colon
			expect(utils.isSafeRefName('a\\b')).toBe(false); // backslash
			expect(utils.isSafeRefName('a\nb')).toBe(false); // newline (control character)
			expect(utils.isSafeRefName('a\x00b')).toBe(false); // NUL (control character)
			expect(utils.isSafeRefName('branch.lock')).toBe(false); // .lock suffix
			expect(utils.isSafeRefName('branch.')).toBe(false); // trailing dot
			expect(utils.isSafeRefName('branch/')).toBe(false); // trailing slash
			expect(utils.isSafeRefName('')).toBe(false); // empty
		});
	});

	describe('isSafeStashSelector', () => {
		it('Should accept stash selectors in the refs/stash@{N} format', () => {
			expect(utils.isSafeStashSelector('refs/stash@{0}')).toBe(true);
			expect(utils.isSafeStashSelector('refs/stash@{12}')).toBe(true);
		});

		it('Should reject anything else', () => {
			expect(utils.isSafeStashSelector('stash@{0}')).toBe(false);
			expect(utils.isSafeStashSelector('--exec=calc')).toBe(false);
			expect(utils.isSafeStashSelector('refs/stash@{0}; rm -rf /')).toBe(false);
			expect(utils.isSafeStashSelector('')).toBe(false);
		});
	});

	describe('quoteShellArg', () => {
		it('Should quote plain values', () => {
			expect(utils.quoteShellArg('master')).toBe('\'master\'');
		});

		it('Should safely embed single quotes (POSIX escaping)', () => {
			// A branch name containing a single quote must not escape the quoted argument
			expect(utils.quoteShellArg('it\'s')).toBe('\'it\'\\\'\'s\'');
		});
	});

	describe('encodeJsonForInlineScript', () => {
		it('Should escape script-terminating sequences', () => {
			const encoded = utils.encodeJsonForInlineScript(JSON.stringify({ repo: '</path/</script><script>alert(1)</script>' }));
			expect(encoded).not.toContain('</script>');
			expect(encoded).not.toContain('<');
			// The escapes decode back to the original value when the script is evaluated
			expect(JSON.parse(encoded.replace(/\\u003C/g, '<').replace(/\\u003E/g, '>').replace(/\\u0026/g, '&'))).toStrictEqual({ repo: '</path/</script><script>alert(1)</script>' });
		});

		it('Should escape invalid JavaScript line separators', () => {
			expect(utils.encodeJsonForInlineScript('a\u2028b')).toBe('a\\u2028b');
			expect(utils.encodeJsonForInlineScript('a\u2029b')).toBe('a\\u2029b');
		});
	});
});

describe('DataSource argument injection prevention', () => {
	let onDidChangeConfiguration: EventEmitter<ConfigurationChangeEvent>;
	let onDidChangeGitExecutable: EventEmitter<utils.GitExecutable>;
	let logger: Logger;
	let dataSource: DataSource;
	let spyOnSpawn: jest.SpyInstance;

	beforeAll(() => {
		onDidChangeConfiguration = new EventEmitter<ConfigurationChangeEvent>();
		onDidChangeGitExecutable = new EventEmitter<utils.GitExecutable>();
		logger = new Logger();
		spyOnSpawn = jest.spyOn(cp, 'spawn');
	});

	afterAll(() => {
		logger.dispose();
		onDidChangeGitExecutable.dispose();
		onDidChangeConfiguration.dispose();
	});

	beforeEach(() => {
		spyOnSpawn.mockReset();
		dataSource = new DataSource({ path: '/path/to/git', version: '2.25.0' }, onDidChangeConfiguration.subscribe, onDidChangeGitExecutable.subscribe, logger);
	});

	afterEach(() => {
		dataSource.dispose();
	});

	const mockGitSuccessOnce = () => {
		mockSpyOnSpawn(spyOnSpawn, (onCallbacks, stderrOnCallbacks, stdoutOnCallbacks) => {
			stdoutOnCallbacks['close']();
			stderrOnCallbacks['close']();
			onCallbacks['exit'](0);
		});
	};

	it('Should reject a fetch remote name that looks like a Git option', async () => {
		const error = await dataSource.fetch('/path/to/repo', '--upload-pack=calc', false, false);
		expect(error).toContain('Invalid reference name');
		expect(spyOnSpawn).not.toHaveBeenCalled();
	});

	it('Should reject a push branch name that looks like a Git option', async () => {
		const error = await dataSource.pushBranch('/path/to/repo', '--receive-pack=calc', 'origin', false, GitPushBranchMode.Normal);
		expect(error).toContain('Invalid reference name');
		expect(spyOnSpawn).not.toHaveBeenCalled();
	});

	it('Should reject a checkout commit hash that looks like a Git option', async () => {
		const error = await dataSource.checkoutCommit('/path/to/repo', '--exec=calc');
		expect(error).toContain('Invalid commit hash');
		expect(spyOnSpawn).not.toHaveBeenCalled();
	});

	it('Should reject a drop commit hash that could smuggle a rebase option', async () => {
		const error = await dataSource.dropCommit('/path/to/repo', '--exec=calc');
		expect(error).toContain('Invalid commit hash');
		expect(spyOnSpawn).not.toHaveBeenCalled();
	});

	it('Should reject a stash selector that looks like a Git option', async () => {
		const error = await dataSource.dropStash('/path/to/repo', '--exec=calc');
		expect(error).toContain('Invalid stash selector');
		expect(spyOnSpawn).not.toHaveBeenCalled();
	});

	it('Should reject an external directory diff with command-injecting hashes', async () => {
		const error = await dataSource.openExternalDirDiff('/path/to/repo', 'HEAD; calc', '1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b', false);
		expect(error).toContain('Invalid commit hash');
		expect(spyOnSpawn).not.toHaveBeenCalled();
	});

	it('Should accept a valid external directory diff (regression: validation must not block legitimate use)', async () => {
		mockGitSuccessOnce();
		const error = await dataSource.openExternalDirDiff('/path/to/repo', '1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b', '2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c', true);
		expect(error).toBeNull();
	});
});

describe('Crash regressions', () => {
	it('evalPromises should settle even when maxParallel is zero', async () => {
		const results = await utils.evalPromises([1, 2, 3], 0, (value) => Promise.resolve(value * 2));
		expect(results).toStrictEqual([2, 4, 6]);
	});

	it('BufferedQueue should process falsy items (e.g. empty strings)', async () => {
		const processed: string[] = [];
		const queue = new BufferedQueue<string>(async (item) => {
			processed.push(item);
			return true;
		}, () => undefined, 10);
		queue.enqueue('');
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(processed).toStrictEqual(['']);
		queue.dispose();
	});
});
