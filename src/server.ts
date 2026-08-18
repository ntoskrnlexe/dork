import index from './index.html';

// Zork I ships with the repo (MIT, see vendor/zork1/). Override to serve another story.
const STORY_PATH = process.env.DORK_STORY ?? 'vendor/zork1/zork1.zip';

const server = Bun.serve({
	port: Number(process.env.PORT) || 3000,
	routes: {
		'/': index,
		'/zork1.zip': () => new Response(Bun.file(STORY_PATH))
	},
	development: {
		hmr: true,
		console: true
	},
	fetch(req) {
		return new Response(`Not found: ${new URL(req.url).pathname}`, { status: 404 });
	}
});

console.log(`dork serving at ${server.url}`);
