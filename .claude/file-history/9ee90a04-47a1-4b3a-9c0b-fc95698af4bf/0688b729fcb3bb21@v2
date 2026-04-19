#!/bin/bash
REPO="/home/nick/personal_git"
cd "$REPO" || exit 1

# Commit local changes first so working tree is clean for rebase
/usr/bin/git add -A
/usr/bin/git commit -m "Sync all local changes" || true

/usr/bin/git fetch origin master

if ! /usr/bin/git rebase origin/master; then
  /usr/bin/git rebase --abort
  echo "Rebase conflict in $REPO at $(date). Please resolve manually." \
    | /usr/bin/mail -s "[personal_git] Rebase conflict - need your help" nick@andestech.com
  exit 1
fi

/usr/bin/git push origin master
