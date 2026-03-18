import os
import shutil

root_dir = r"c:\Users\tanb2\Desktop\KIOSK_FRONTEND_V1"

# Skip directories at the root level to prevent scanning them
skip_root_dirs = {'.agent', '.ai', '.git'}

# Also optionally skip node_modules if it is too massive, but the prompt says ALL so we'll just skip .agent, .ai, .git
for dirpath, dirnames, filenames in os.walk(root_dir, topdown=True):
    if dirpath == root_dir:
        # Prevent walking into skip directories
        dirnames[:] = [d for d in dirnames if d not in skip_root_dirs]
        
    for filename in filenames:
        if filename.lower().endswith('.md') or filename.lower().endswith('.docs') or filename.lower() == 'docs':
            filepath = os.path.join(dirpath, filename)
            try:
                os.remove(filepath)
                print(f"Deleted file: {filepath}")
            except Exception as e:
                print(f"Failed to delete {filepath}: {e}")
                
    for dirname in list(dirnames):
        if dirname.lower() == 'docs':
            dirpath_full = os.path.join(dirpath, dirname)
            try:
                shutil.rmtree(dirpath_full)
                print(f"Deleted directory: {dirpath_full}")
                dirnames.remove(dirname) # prevent walking into deleted directory
            except Exception as e:
                print(f"Failed to delete directory {dirpath_full}: {e}")
