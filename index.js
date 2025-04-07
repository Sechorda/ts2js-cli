#!/usr/bin/env node
const { program } = require('commander');
const simpleGit = require('simple-git');
const { readFiles } = require('node-dir');
const { writeFile, rename } = require('fs');
const { parse, print } = require('recast');
const { transformFromAstSync } = require('@babel/core');
const transformTypescript = require('@babel/plugin-transform-typescript');
const getBabelOptions = require('recast/parsers/_babel_options.js');
const { parser } = require('recast/parsers/babel.js');

// Conversion function
function toJs(content) {
  try {
    const ast = parse(content, {
      parser: {
        parse: (source, options) => {
          const babelOptions = getBabelOptions.default(options);
          babelOptions.plugins.push("typescript", "jsx");
          return parser.parse(source, babelOptions);
        },
      },
    });

    const options = {
      cloneInputAst: false,
      code: false,
      ast: true,
      plugins: [transformTypescript],
      configFile: false,
    };
    const { ast: transformedAST } = transformFromAstSync(ast, content, options);
    return print(transformedAST).code;
  } catch (e) {
    console.error('Conversion error:', e.message);
    throw e;
  }
}

// Main conversion function
async function convertFiles(dir) {
  console.log('Converting files in:', dir);
  
  const files = await new Promise((resolve, reject) => {
    readFiles(dir, {
      excludeDir: ['node_modules'],
      match: /\.tsx?$/,
    }, (err, content, filename, next) => {
      if (err) return reject(err);
      try {
        const newContent = toJs(content);
        writeFile(filename, newContent, (err) => {
          if (err) console.error('Write error:', filename, err);
          next();
        });
      } catch (e) {
        console.error('Failed to convert:', filename);
        next();
      }
    }, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });

  // Rename files
  for (const file of files) {
    const newName = file.replace(/(\.ts)$/i, ".js").replace(/(\.tsx)$/i, ".jsx");
    rename(file, newName, (err) => {
      if (err) console.error('Rename error:', file, err);
    });
  }

  console.log('Conversion complete. Processed', files.length, 'files');
}

// Git branch handling
async function handleGitBranch(dir) {
  const git = simpleGit(dir);
  const currentBranch = (await git.branch()).current;
  
  if (/ts|js/i.test(currentBranch)) {
    console.log('Already in TS/JS branch:', currentBranch);
    return;
  }

  const newBranch = 'convert-ts-to-js';
  console.log('Creating new branch:', newBranch);
  await git.checkoutLocalBranch(newBranch);
}

// Remove TypeScript packages
async function removeTSPackages(dir) {
  const { execSync } = require('child_process');
  try {
    console.log('Removing TypeScript packages...');
    execSync('npm remove typescript', { cwd: dir, stdio: 'inherit' });
    
    // Remove @types packages
    const packageJson = require(`${dir}/package.json`);
    const typesPackages = Object.keys(packageJson.dependencies || {})
      .concat(Object.keys(packageJson.devDependencies || {}))
      .filter(pkg => pkg.startsWith('@types/'));
      
    if (typesPackages.length) {
      execSync(`npm remove ${typesPackages.join(' ')}`, { cwd: dir, stdio: 'inherit' });
    }
  } catch (err) {
    console.error('Package removal error:', err.message);
  }
}

// Remove tsconfig.json
async function removeTSConfig(dir) {
  const { unlink } = require('fs/promises');
  try {
    await unlink(`${dir}/tsconfig.json`);
    console.log('Removed tsconfig.json');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Error removing tsconfig.json:', err.message);
    }
  }
}

// CLI setup
program
  .name('ts2js')
  .description('Convert TypeScript files to JavaScript in-place')
  .argument('<directory>', 'project directory to convert')
  .option('--no-packages', 'skip removing TypeScript packages')
  .option('--no-config', 'skip removing tsconfig.json')
  .action(async (dir, options) => {
    try {
      await handleGitBranch(dir);
      await convertFiles(dir);
      
      if (options.packages !== false) await removeTSPackages(dir);
      if (options.config !== false) await removeTSConfig(dir);
      
      console.log('Successfully converted project');
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
