#!/usr/bin/env python3
"""Prepare a patched JJ candidate without touching the installed BB or source workspace."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import shlex
import uuid

ROOT = Path(__file__).resolve().parents[1]

def run(args, cwd):
    return subprocess.run(args, cwd=cwd, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Existing BB Jujutsu repository')
    parser.add_argument('--workspace', type=Path, required=True, help='New candidate directory (must not exist)')
    parser.add_argument('--base', help='Optional newer revision to attempt; conflicts stop preparation')
    parser.add_argument('--verify', action='store_true', help='Run the pinned manifest checks and native smoke after preparing')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'patches/manifest.json').read_text())
    patches = []
    for layer in manifest['patches']:
        patch = (ROOT / 'patches' / layer['file']).resolve()
        if patch.parent != (ROOT / 'patches').resolve():
            raise ValueError('Patch path escapes the patch bundle')
        if hashlib.sha256(patch.read_bytes()).hexdigest() != layer['sha256']:
            raise ValueError('Patch checksum does not match the manifest: ' + patch.name)
        patches.append(patch)
    source = args.source.resolve(strict=True)
    run(['jj', 'root'], source)
    workspace = args.workspace.absolute()
    if workspace.exists():
        raise ValueError('Candidate directory already exists; refusing to modify it')
    base = args.base or manifest['baseRevision']
    resolved = run(['jj', 'log', '-r', base, '--no-graph', '-T', 'commit_id'], source)
    if len(resolved) != 40:
        raise ValueError('Base must resolve to exactly one commit')
    name = 'browser-workbench-' + uuid.uuid4().hex[:10]
    print(run(['jj', 'workspace', 'add', '--name', name, '-r', resolved, str(workspace)], source))
    # jj has no patch-file application command; git apply does not stage or commit.
    for patch in patches:
        run(['git', 'apply', '--check', str(patch)], workspace)
        run(['git', 'apply', str(patch)], workspace)
    run(['jj', 'describe', '-m', 'feat: native browser workbench (prepared patch candidate)'], workspace)
    if args.verify:
        for command in manifest['verification']:
            subprocess.run(shlex.split(command), cwd=workspace, check=True)
        subprocess.run(['node', str(ROOT / 'scripts/smoke-native.mjs'), str(workspace)], cwd=ROOT, check=True)
    receipt = {'workspace': str(workspace), 'workspaceName': name, 'baseRevision': resolved,
               'patches': manifest['patches'], 'state': 'verified-source-build' if args.verify else 'prepared-unverified',
               'installedChanged': False, 'verification': manifest['verification']}
    print(json.dumps(receipt, indent=2))
    print('Candidate prepared. Run the manifest verification before packaging. Installed BB is unchanged.')

if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stderr or error.stdout or str(error), file=sys.stderr)
        print('Stopped. The isolated candidate is retained for inspection; installed BB was not changed.', file=sys.stderr)
        sys.exit(1)
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
