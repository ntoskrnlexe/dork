import index from './index.html';

const STORY_PATH = '../zork1/zork1.zip';

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
