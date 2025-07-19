const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * Copy Python server file to dist directory
 * @type {import('esbuild').Plugin}
 */
const copyFilesPlugin = {
	name: 'copy-files',
	setup(build) {
		build.onEnd(() => {
			// Copy Python files to dist directory
			try {
				if (!fs.existsSync('dist')) {
					fs.mkdirSync('dist');
				}
				
				// Copy server script
				fs.copyFileSync('conan_server.py', 'dist/conan_server.py');
				console.log('Copied conan_server.py to dist/');
				
				// Copy requirements file
				if (fs.existsSync('requirements.txt')) {
					fs.copyFileSync('requirements.txt', 'dist/requirements.txt');
					console.log('Copied requirements.txt to dist/');
				}
			} catch (error) {
				console.warn('Warning: Could not copy Python files:', error.message);
			}
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			copyFilesPlugin,
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
