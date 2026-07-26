#!/usr/bin/env python3
import os
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

# Import o top-level de PyInstaller thu thap module (khong de trong if __name__).
from cli.main import main

if __name__ == '__main__':
    os.chdir(project_root)
    main()
