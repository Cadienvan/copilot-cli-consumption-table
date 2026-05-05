#!/bin/bash

# Define directories
SOURCE_DIR="$HOME/.copilot/session-state"
DEST_DIR="./data"

# Check if the Copilot session directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: Copilot session directory not found at $SOURCE_DIR"
    exit 1
fi

# Create the data destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

echo "🔍 Searching for .jsonl files in $SOURCE_DIR..."

count=0

# Find all .jsonl files and process them. 
# We use -print0 and read -d '' to safely handle any spaces or weird characters in paths.
while IFS= read -r -d '' file; do
    # Get the parent folder name (which is the session UUID)
    parent_dir=$(basename "$(dirname "$file")")
    
    # Get the original file name (usually events.jsonl)
    filename=$(basename "$file")
    
    # Create a unique name to prevent overwriting: <UUID>_<filename>
    unique_name="${parent_dir}_${filename}"
    
    # Copy the file to the data directory
    cp "$file" "$DEST_DIR/$unique_name"
    
    ((count++))
done < <(find "$SOURCE_DIR" -type f -name "*.jsonl" -print0)

echo "✅ Successfully copied $count .jsonl files into $DEST_DIR/"