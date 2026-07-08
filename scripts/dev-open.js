// Wraps `next dev` and opens the browser once the dev server reports it's
// listening, using whatever port it actually bound (next dev auto-increments
// past busy ports, so the port can't just be hardcoded here).
const { spawn, exec } = require('child_process');

const child = spawn('npx next dev', { stdio: ['inherit', 'pipe', 'inherit'], shell: true });

let opened = false;

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (opened) return;
  const match = text.match(/Local:\s+(https?:\/\/localhost:\d+)/);
  if (!match) return;
  opened = true;
  const url = match[1];
  const openCommand =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(openCommand);
});

child.on('close', (code) => process.exit(code ?? 0));
