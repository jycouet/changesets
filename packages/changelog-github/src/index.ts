import { ChangelogFunctions } from "@changesets/types";
// @ts-ignore
import { config } from "dotenv";
import { getInfo, getInfoFromPullRequest } from "@changesets/get-github-info";

config();

// "match what you skip, capture what you want": the left alternative
// consumes markdown links so the right alternative only matches bare refs
function linkifyIssueRefs(
  line: string,
  { serverUrl, repo }: { serverUrl: string; repo: string }
): string {
  return line.replace(/\[.*?\]\(.*?\)|\B#([1-9]\d*)\b/g, (match, issue) =>
    // PRs and issues are the same thing on GitHub (to some extent, of course)
    // this relies on GitHub redirecting from /issues/1234 to /pull/1234 when necessary
    issue ? `[#${issue}](${serverUrl}/${repo}/issues/${issue})` : match
  );
}

// narrow autolinking used by `autolinkIssues: "hints"`: only links a ref that
// sits inside `(fix #123)`, `(fixes #123)`, or `(see #123)`
function linkifyIssueHints(
  line: string,
  { serverUrl, repo }: { serverUrl: string; repo: string }
): string {
  return line.replace(
    /(?<=\( ?(?:fix|fixes|see) )#(\d+)(?= ?\))/g,
    (_match, issue) => `[#${issue}](${serverUrl}/${repo}/issues/${issue})`
  );
}

function readEnv() {
  const GITHUB_SERVER_URL =
    process.env.GITHUB_SERVER_URL || "https://github.com";
  return { GITHUB_SERVER_URL };
}

export const RELEASE_LINE_TOKENS = [
  "summary",
  "ref",
  "pr",
  "commit",
  "thanks",
  "authors",
] as const;

export function renderTemplate(
  template: string,
  tokens: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(tokens, name)) {
      throw new Error(
        `Unknown changelog template token "{${name}}". Valid tokens are: ${RELEASE_LINE_TOKENS.map(
          (t) => `{${t}}`
        ).join(", ")}.`
      );
    }
    return tokens[name];
  });
}

export function buildReleaseLineTokens(args: {
  summary: string;
  links: { pull: string | null; commit: string | null; user: string | null };
  users: string | null;
}): Record<string, string> {
  const { summary, links, users } = args;
  const ref = links.pull
    ? ` (${links.pull})`
    : links.commit
    ? ` (${links.commit})`
    : "";
  return {
    summary,
    ref,
    pr: links.pull ? ` ${links.pull}` : "",
    commit: links.commit ? ` ${links.commit}` : "",
    thanks: users ? ` Thanks ${users}!` : "",
    authors: users ? ` ${users}` : "",
  };
}

const changelogFunctions: ChangelogFunctions = {
  getDependencyReleaseLine: async (
    changesets,
    dependenciesUpdated,
    options
  ) => {
    if (!options.repo) {
      throw new Error(
        'Please provide a repo to this changelog generator like this:\n"changelog": ["@changesets/changelog-github", { "repo": "org/repo" }]'
      );
    }
    if (dependenciesUpdated.length === 0) return "";

    const changesetLink = `- Updated dependencies [${(
      await Promise.all(
        changesets.map(async (cs) => {
          if (cs.commit) {
            let { links } = await getInfo({
              repo: options.repo,
              commit: cs.commit,
            });
            return links.commit;
          }
        })
      )
    )
      .filter((_) => _)
      .join(", ")}]:`;

    const updatedDepenenciesList = dependenciesUpdated.map(
      (dependency) => `  - ${dependency.name}@${dependency.newVersion}`
    );

    return [changesetLink, ...updatedDepenenciesList].join("\n");
  },
  getReleaseLine: async (changeset, type, options) => {
    const { GITHUB_SERVER_URL } = readEnv();
    if (!options || !options.repo) {
      throw new Error(
        'Please provide a repo to this changelog generator like this:\n"changelog": ["@changesets/changelog-github", { "repo": "org/repo" }]'
      );
    }

    let prFromSummary: number | undefined;
    let commitFromSummary: string | undefined;
    let usersFromSummary: string[] = [];

    const replacedChangelog = changeset.summary
      .replace(/^\s*(?:pr|pull|pull\s+request):\s*#?(\d+)/im, (_, pr) => {
        let num = Number(pr);
        if (!isNaN(num)) prFromSummary = num;
        return "";
      })
      .replace(/^\s*commit:\s*([^\s]+)/im, (_, commit) => {
        commitFromSummary = commit;
        return "";
      })
      .replace(/^\s*(?:author|user):\s*@?([^\s]+)/gim, (_, user) => {
        usersFromSummary.push(user);
        return "";
      })
      .trim();

    const [firstLine, ...futureLines] = replacedChangelog
      .split("\n")
      .map((l) => l.trimEnd());

    const autolink = (line: string): string => {
      const linkOpts = { serverUrl: GITHUB_SERVER_URL, repo: options.repo };
      return options.autolinkIssues === "hints"
        ? linkifyIssueHints(line, linkOpts)
        : linkifyIssueRefs(line, linkOpts);
    };

    const links = await (async () => {
      if (prFromSummary !== undefined) {
        let { links } = await getInfoFromPullRequest({
          repo: options.repo,
          pull: prFromSummary,
        });
        if (commitFromSummary) {
          const shortCommitId = commitFromSummary.slice(0, 7);
          links = {
            ...links,
            commit: `[\`${shortCommitId}\`](${GITHUB_SERVER_URL}/${options.repo}/commit/${commitFromSummary})`,
          };
        }
        return links;
      }
      const commitToFetchFrom = commitFromSummary || changeset.commit;
      if (commitToFetchFrom) {
        let { links } = await getInfo({
          repo: options.repo,
          commit: commitToFetchFrom,
        });
        return links;
      }
      return {
        commit: null,
        pull: null,
        user: null,
      };
    })();

    const users = options.disableThanks
      ? null
      : usersFromSummary.length
      ? usersFromSummary
          .map(
            (userFromSummary) =>
              `[@${userFromSummary}](${GITHUB_SERVER_URL}/${userFromSummary})`
          )
          .join(", ")
      : links.user;

    const prefix = [
      links.pull === null ? "" : ` ${links.pull}`,
      links.commit === null ? "" : ` ${links.commit}`,
      users === null ? "" : ` Thanks ${users}!`,
    ].join("");

    if (typeof options.template === "string" && options.template.length > 0) {
      const tokens = buildReleaseLineTokens({
        summary: autolink(firstLine),
        links,
        users,
      });
      const rendered = renderTemplate(options.template, tokens);
      return `${rendered}\n${futureLines
        .map((l) => `  ${autolink(l)}`)
        .join("\n")}`;
    }

    return `\n\n-${prefix ? `${prefix} -` : ""} ${autolink(
      firstLine
    )}\n${futureLines.map((l) => `  ${autolink(l)}`).join("\n")}`;
  },
};

export default changelogFunctions;
