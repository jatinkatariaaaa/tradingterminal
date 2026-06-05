const fs = require("fs")
const path = require("path")

console.log("Searching for usd_per_unit in workspace...")

function searchDir(dirPath) {
  let entries
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch (e) {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".next" ||
        entry.name === "out"
      ) {
        continue
      }
      searchDir(fullPath)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if ([".ts", ".tsx", ".sql", ".js", ".json"].includes(ext)) {
        try {
          const content = fs.readFileSync(fullPath, "utf8")
          if (content.includes("usd_per_unit")) {
            console.log(`Found in: ${fullPath}`)
          }
        } catch (e) {
          // Ignored
        }
      }
    }
  }
}

searchDir("C:\\Users\\jatin\\Downloads\\propfirms-main")
