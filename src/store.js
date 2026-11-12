import fs from "node:fs";
import path from "node:path";

/** Arquivo JSON simples com escrita atômica (grava em .tmp e renomeia). */
export class JsonStore {
  constructor(file, fallback) {
    this.file = file;
    this.data = fallback;
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, "utf8"));
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
