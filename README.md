# Git Branch & Tag Graph

**This extension is a distinct fork of the original [Git Graph](https://github.com/mhutchie/vscode-git-graph) extension.**

View a Git Graph of your repository, and perform Git actions from the graph. This fork includes critical fixes for recent VS Code versions and new features not present in the original.

**Source Code**: [GitHub](https://github.com/neophack/vscode-gerrit-graph)

For any issues or advice, you can find the pull requests page [here](https://github.com/neophack/vscode-gerrit-graph/pulls).
## Resources

*   [Issues](https://github.com/neophack/vscode-gerrit-graph/issues)
*   [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=neophack.gerrit-graph)
*   [Open VSX Registry](https://open-vsx.org/extension/neophack/gerrit-graph) (A 2nd marketplace synced with the Visual Studio Marketplace, specifically for downloading the extension in editors or IDEs that support Open VSX extensions.)

This version aims to address some of the long-standing issues and to keep up with the latest VSCode updates.


## Why a Fork?

The original Git Graph extension is an excellent tool, but some issues have remained unresolved for a while. This fork was created to:

*   Fix the disappearing context menu in recent VSCode versions.
*   Improve performance and responsiveness.
*   Add new features that enhance the user experience.

## Distinguishing Features

*   **Bug Fixes**: Solve context right-click menu dissapeared since 1.97 vscode.
*   **Tag Filtering**: A new dropdown menu allows you to filter the graph by tags.
*   **Performance Improvements**: The extension's activation events have been optimized for faster startup.
*   **Find Widget**: A search widget has been added to quickly find commits.
*   **Commit Message Formatting**: Support for double newlines in commit messages has been added.

## Major Changes Since 1.31.0

*   **Context Menu Fix**: The disappearing context menu issue in recent versions of VSCode has been resolved.
*   **Tag Dropdown Filter**: A new dropdown menu has been added to filter the graph by tags, making it easier to visualize releases and other important points in your repository's history.
*   **Performance Enhancements**: The extension's activation events have been optimized to improve startup performance, so you can get to your graph faster.
*   **Find Widget**: A new find widget has been integrated, allowing you to quickly search for commits by message, author, or hash.
*   **Commit Message Formatting**: Support for double newlines in commit messages has been added, improving the readability of your commit history.

## What's New in Version 1.34.0

This release includes several new features and improvements. For a detailed list of changes, please refer to the [CHANGELOG.md](CHANGELOG.md).

## Features

This fork retains all the features of the original Git Graph extension, including:

*   **Git Graph View**: A rich, interactive graph of your repository's history.
*   **Git Actions**: Perform a wide range of Git actions directly from the graph.
*   **Commit Details**: View detailed information about commits and file changes.
*   **Commit Comparison**: Compare any two commits to see the differences.
*   **Code Review**: Keep track of reviewed files in the Commit Details and Comparison Views.
*   **Branch and Tag Filtering**: Filter the graph by branches and tags.
*   **Find Widget**: Search for commits by message, author, or hash.
*   **Repository Settings**: Configure remotes, issue linking, and pull request creation.
*   **Customization**: A wide range of settings to customize the look and feel of the graph.

## Code Review

This extension supports two complementary review workflows:

### 1. Local Code Review Tracking

Keep track of which files you have already reviewed, directly in the Commit Details & Comparison Views:

*   Start or stop a Code Review at any time from the button on the right of the Commit Details or Comparison View.
*   A Code Review can be performed on any single commit, or between any two commits (but not on Uncommitted Changes).
*   Use the **"Mark as Reviewed"** / **"Mark as Not Reviewed"** actions on the file context menu to track your progress as you go.
*   Commands are available to **End All Code Reviews in Workspace**, **End a specific Code Review in Workspace...**, and **Resume a specific Code Review in Workspace...** — so you can pause a review and pick it up again later without losing your progress.

### 2. Gerrit Code Review Integration

For repositories hosted on [Gerrit](https://www.gerritcodereview.com/), the extension integrates the review workflow directly into the graph:

*   **Change badges on commits**: commits that belong to a Gerrit change display a badge with the change number, and optionally the **Code-Review (CR)** and **Verified (V)** score labels, so you can see the review state of a change at a glance.
*   **Review event timeline**: the review history of each change (patchsets, votes, status transitions) is anchored to its commits in the graph. Clicking an event row expands the full verbatim NoteDb record — patchset, commit hash, labels, status and submit footers — in a monospace block.
*   **Change dialog**: click a change badge to open a dialog showing the change owner and the complete event timeline.
*   **Submit for Review**: a toolbar button pushes HEAD to `refs/for/<branch>` in one click. It performs safety checks (e.g. HEAD must not already be pushed to a remote), and an **Amend Change-Id** action generates and amends a Gerrit-shaped Change-Id onto HEAD when it is missing.
*   **Change fetching**: Gerrit change refs (`refs/changes/*`) are fetched in the background. You can choose to fetch only the latest patchset of each change or all patchsets, cache all open changes or just the latest N, and optionally auto-fetch periodically.
*   **Status filtering**: toolbar chips let you toggle which change statuses are shown — awaiting review (NEW), merged, abandoned, and work-in-progress (WIP).

The Gerrit integration is controlled by the `review-graph.gerrit.*` settings (enabled by default), including:

| Setting | Description |
| --- | --- |
| `review-graph.gerrit.enabled` | Enable/disable the Gerrit integration (change refs, review progress badges, submitting commits for review). |
| `review-graph.gerrit.remote` | The remote used for Gerrit change refs (default `origin`). |
| `review-graph.gerrit.fetchMode` | Fetch changes: `off`, `latest` (only the latest N changes) or `all` (all open changes). |
| `review-graph.gerrit.fetchLimit` | How many latest changes to fetch and keep locally in `latest` mode (1–10000, default 20). |
| `review-graph.gerrit.patchsets` | Fetch only the `latest` patchset of each change, or `all` patchsets. |
| `review-graph.gerrit.autoFetch` | Periodically fetch Gerrit changes automatically. |
| `review-graph.gerrit.showChangeRefs` | Show Gerrit change badges on commits. |
| `review-graph.gerrit.includeChangeCommits` | Include Gerrit change commits in the graph. |
| `review-graph.gerrit.showReviewProgress` | Show Code-Review / Verified score labels on change badges. |
| `review-graph.gerrit.showMetaCommits` | Show the review event timeline anchored to change commits (`collapsed`, `expanded` or `off`). |
| `review-graph.gerrit.statusFilter` | Which change statuses are shown in the graph (also toggleable from the toolbar). |
| `review-graph.gerrit.showPushButton` | Show the "Submit for Review" toolbar button. |

## Extension Settings

For a detailed list of all available settings, please refer to the [Extension Settings documentation](https://github.com/git-hub-tig/vscode-git-graph/wiki/Extension-Settings).

## Release Notes

Detailed release notes are available in the [CHANGELOG.md](CHANGELOG.md).

## Acknowledgements

A big thank you to the original author, [mhutchie](https://github.com/mhutchie), for creating this amazing extension.

Some of the icons used in Git Graph are from the following sources:
- [GitHub Octicons](https://octicons.github.com/) ([License](https://github.com/primer/octicons/blob/master/LICENSE))
- [Icons8](https://icons8.com/icon/pack/free-icons/ios11) ([License](https://icons8.com/license))