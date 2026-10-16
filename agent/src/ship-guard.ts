// 수정 run의 배포 동작은 데몬만 수행한다. 대화형 권한과 같은 셸 토큰화를 사용한다.
import { shellSegments, shellWordsNorm } from "./permissions.ts";

const nameOf = (s: string) => s.replace(/\\/g, "/").split("/").pop()!.toLowerCase().replace(/\.exe$/, "");
const GIT_COMMANDS = new Set(["status", "diff", "log", "show", "rev-parse", "rev-list", "ls-files", "ls-tree", "grep", "blame", "check-ignore", "check-attr", "describe", "symbolic-ref", "remote", "fetch", "add", "restore", "checkout", "switch", "branch", "worktree", "cherry-pick", "apply", "config", "reset"]);

export function isShipCommandBlocked(command: string, depth = 0): boolean {
  if (depth > 4) return true;
  // 치환으로 명령을 숨기면 확인할 수 없다. 셸 전체를 격리하는 기능은 아니다.
  if (/[$`]/.test(command) && /git|\bgh\b|push|commit|merge/.test(command)) return true;
  for (const segment of shellSegments(command)) {
    const words = shellWordsNorm(segment);
    for (let at = 0; at < words.length; at++) {
      const bin = nameOf(words[at]);
      if (/^(ba|z|da|k)?sh$/.test(bin)) {
        const c = words.findIndex((w, i) => i > at && /^-[a-z]*c/.test(w));
        if (c >= 0 && isShipCommandBlocked(words.slice(c + 1).join(" "), depth + 1)) return true;
      }
      if (bin === "git" || bin === "gh") {
        let i = at + 1;
        for (; i < words.length && words[i].startsWith("-"); i++) {
          const arg = words[i];
          if (["-C", "-c", "-R", "--repo", "--git-dir", "--work-tree"].includes(arg)) { i++; continue; }
          if (/^(?:-C.|-c.|-R.|--(?:repo|git-dir|work-tree)=)/.test(arg) || ["--no-pager", "--paginate", "--no-optional-locks", "--literal-pathspecs"].includes(arg)) continue;
          return true; // 알려지지 않은 전역 옵션은 동작을 확정할 수 없음
        }
        const sub = words[i], args = words.slice(i + 1);
        if (bin === "gh") {
          if (!sub || !["pr", "repo", "issue", "run", "auth"].includes(sub)) return true;
          if (!args.length || !["view", "list", "diff", "checks", "status"].includes(args[0])) return true;
        } else {
          if (!sub || !GIT_COMMANDS.has(sub)) return true;
          if (["checkout", "switch"].includes(sub) && args.some((a) => /^(main|master|develop|prod.*|release.*)$/.test(a))) return true;
          if (sub === "reset" && args.includes("--hard")) return true;
          if (sub === "branch" && args.some((a) => a === "--delete" || /^-[A-Za-z]*[dD][A-Za-z]*$/.test(a))) return true;
          if (sub === "worktree" && args[0] === "remove") return true;
          if (sub === "config" && !args.some((a) => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(a))) return true;
        }
      }
      if (bin === "rm" && words.slice(at + 1).some((w) => /^-[a-z]*[rf]/.test(w)) && words.slice(at + 1).some((w) => /^[~\/]/.test(w))) return true;
    }
  }
  return false;
}
