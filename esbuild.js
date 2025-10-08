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
			const fs = require('fs');
			const path = require('path');
			
			// Copy Python files from backend directory to dist directory
			const filesToCopy = [
				'backend/conan_server.py',
				'backend/conan_utils.py',
				'backend/models/__init__.py',
				'backend/models/conan_models.py',
				'backend/dependencies/__init__.py',
				'backend/dependencies/conan_deps.py',
				'backend/routes/__init__.py',
				'backend/routes/packages.py',
				'backend/routes/profiles.py',
				'backend/routes/remotes.py',
				'backend/routes/config.py'
			];
			
			filesToCopy.forEach(file => {
				const srcPath = path.join(__dirname, file);
				const destPath = path.join(__dirname, 'dist', file);
				
				// Create directory if it doesn't exist
				const destDir = path.dirname(destPath);
				if (!fs.existsSync(destDir)) {
					fs.mkdirSync(destDir, { recursive: true });
				}
				
				if (fs.existsSync(srcPath)) {
					fs.copyFileSync(srcPath, destPath);
					console.log(`Copied ${file} to dist/`);
				} else {
					console.warn(`Warning: ${file} not found`);
				}
			});
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
