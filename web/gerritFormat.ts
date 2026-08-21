/* Gerrit Formatting Helpers */

/** Format a Gerrit vote/score value with an explicit '+' sign for positive values (e.g. "+2", "-1", "0"). */
function formatGerritScore(value: number) {
	return (value > 0 ? '+' : '') + value;
}

/** Format a Gerrit event's summary text, with its labels (if any) appended (e.g. "Patch Set 2: (Code-Review+2)"). */
function formatGerritEventText(event: GG.GerritChangeEvent) {
	return escapeHtml(event.raw) + (event.labels !== undefined ? ' (' + event.labels.map((label) => escapeHtml(label.name) + formatGerritScore(label.value)).join(', ') + ')' : '');
}

function gerritChangeEventsEqual(a: ReadonlyArray<GG.GerritChangeEvent>, b: ReadonlyArray<GG.GerritChangeEvent>) {
	return arraysEqual(a, b, (x, y) =>
		x.type === y.type && x.patchset === y.patchset && x.reviewer === y.reviewer &&
		x.timestamp === y.timestamp && x.raw === y.raw && x.rawFull === y.rawFull &&
		(x.labels === undefined || y.labels === undefined
			? x.labels === y.labels
			: arraysEqual(x.labels, y.labels, (p, q) => p.name === q.name && p.value === q.value))
	);
}

/**
 * Are two Gerrit change state maps equal. Short-circuits on the first difference found, avoiding
 * the cost of JSON.stringify-ing the full (potentially large) event history of every change just
 * to detect whether anything actually changed.
 */
function gerritStatesEqual(a: { [hash: string]: GG.GerritChangeState }, b: { [hash: string]: GG.GerritChangeState }) {
	const aHashes = Object.keys(a);
	if (aHashes.length !== Object.keys(b).length) return false;
	return aHashes.every((hash) => {
		const x = a[hash], y = b[hash];
		return typeof y !== 'undefined' &&
			x.change === y.change && x.patchset === y.patchset && x.codeReview === y.codeReview &&
			x.verified === y.verified && x.status === y.status && x.wip === y.wip &&
			x.headHash === y.headHash && x.url === y.url &&
			gerritChangeEventsEqual(x.events, y.events);
	});
}

