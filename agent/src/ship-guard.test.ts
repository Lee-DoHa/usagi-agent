import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedBash, noShipHook } from "./fixer.ts";

test("수정 run: Git·gh 전역 옵션과 셸 감싸기로 배포 차단을 우회할 수 없다", async () => {
  for (const command of ["git -C . push origin main", "git -c core.hooksPath=/dev/null push", "git --git-dir=.git commit -m x", "git --work-tree=. merge x", "gh -R owner/repo pr merge 1", "gh --repo=owner/repo pr create", "'git' -C . push", "g\\it push", "GIT.exe -C . push", "bash -c 'git -C . push'", "git -c alias.ship=push ship", "git reset --hard", "git branch -D feature/x"]) {
    assert.equal(isBlockedBash(command), true, command);
    const result: any = await noShipHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } } as any, "tool", {} as any);
    assert.equal(result.hookSpecificOutput?.permissionDecision, "deny", command);
  }
  for (const command of ["git -C . diff", "git -c color.ui=false status", "git log --grep commit", "gh -R owner/repo pr view 1", "git cherry-pick -n feature/x", "npm test", "rm -rf node_modules"]) assert.equal(isBlockedBash(command), false, command);
});
