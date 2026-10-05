import { packageVersion, npmLockVersion, parseVersion, replaceRequired } from './version-control.mjs';

export default {
  targets: [
    { path: 'package.json', transform: packageVersion },
    { path: 'package-lock.json', transform: npmLockVersion },
    { path: 'README.md', transform: (text, version) => {
      const line = `**Version:** \`${version}\` (CalVer)`;
      const pattern = /\*\*Version:\*\* `[^`]+` \(CalVer\)/g;
      if (pattern.test(text)) return text.replace(pattern, line);
      return replaceRequired(text, /\*\*The Elite HTML-to-PDF\/PNG Conversion Engine\*\*\r?\n/, (header) => `${header}\n${line}\n`);
    } },
    { path: 'documents/deployment.md', transform: (text, version) => {
      const [year, month] = parseVersion(version);
      for (const [pattern, replacement] of [
        [/(\*\*Pull the latest image:\*\*\s*```bash\s*docker pull ghcr\.io\/zr0aces\/viewsarn:)\S+/g, (_, prefix) => `${prefix}latest`],
        [/(\*\*Pull a specific version:\*\*\s*```bash\s*docker pull ghcr\.io\/zr0aces\/viewsarn:)\S+/g, (_, prefix) => `${prefix}${version}`],
        [/- `[^`]+` - Specific version \([^)]+\)/g, `- \`${version}\` - Specific version (CalVer YYYY.M.MINOR)`],
        [/- `[^`]+` - (?:Major\.minor version|Year\.month tag \(YYYY\.M\))/g, `- \`${year}.${month}\` - Year.month tag (YYYY.M)`],
        [/- `[^`]+` - (?:Major version only|Year tag \(YYYY\))/g, `- \`${year}\` - Year tag (YYYY)`],
        [/\(e\.g\., `v[^`]+`\)/g, `(e.g., \`v${version}\`)`],
      ]) text = replaceRequired(text, pattern, replacement);
      return text;
    } },
  ],
};
