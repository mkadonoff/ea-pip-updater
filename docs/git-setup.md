# Git & VS Code setup (Windows)

This document explains how to install Git on Windows and configure VS Code to use it for this workspace.

## 1) Install Git for Windows

1. Download and run the installer from https://git-scm.com/download/win
2. During installation, choose "Use Git from the Windows Command Prompt" to add it to PATH (recommended).
3. Finish installation.

## 2) Verify Git in PowerShell

Open PowerShell and run:

```powershell
git --version
```

You should see a version string, e.g. `git version 2.####.#`.

If not on PATH, locate `git.exe` (usually `C:\Program Files\Git\bin\git.exe`) and add it to PATH or set `git.path` in `.vscode/settings.json`.

## 3) Configure user identity

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## 4) Using Git from VS Code

- Recommended extensions are in `.vscode/extensions.json`:
  - GitLens (eamodio.gitlens)
  - Git Graph (mhutchie.git-graph)
  - GitHub Pull Requests and Issues (github.vscode-pull-request-github)

- Use the Source Control view in VS Code to stage/commit/push.
- Run the `Git: status` task from the Run Task palette (Ctrl+Shift+P -> Tasks: Run Task -> Git: status) to see current branch and local changes.

## 5) Common commands

```powershell
# fetch remote updates
git fetch origin --prune

# view local changes
git status

git add -A
git commit -m "message"

# push current branch
git push
```

## 6) If .env was committed by mistake

If you accidentally committed `.env`, remove it and rotate secrets immediately:

```powershell
git rm --cached .env
git commit -m "chore: remove .env from repository"
git push
```

For full history rewrite (use with care): use BFG or `git filter-branch` and rotate any exposed secrets.

---

If you want, I can generate a patch file with the repo changes or walk you through the exact git commands to commit and push from your environment.