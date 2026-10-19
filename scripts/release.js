#!/usr/bin/env node

/**
 * Script de release semi-automatique pour vote-cdm.
 * - Conforme à Keep a Changelog 1.1.0 et Semantic Versioning.
 * - Zéro dépendance externe (utilise les modules natifs Node.js).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');

function run(cmd, options = {}) {
  return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', stdio: options.silent ? 'pipe' : 'pipe', ...options }).trim();
}

function getRepoUrl() {
  try {
    const remote = run('git remote get-url origin', { silent: true });
    if (remote.startsWith('git@github.com:')) {
      return `https://github.com/${remote.replace('git@github.com:', '').replace(/\.git$/, '')}`;
    }
    if (remote.startsWith('https://github.com/')) {
      return remote.replace(/\.git$/, '');
    }
  } catch {
    // fallback
  }
  return 'https://github.com/emiliemichaud/vote-cdm';
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Version SemVer invalide : ${version}`);
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function categorizeCommits(commits) {
  const categories = {
    Added: [],
    Changed: [],
    Fixed: [],
    Security: [],
  };

  for (const line of commits) {
    const trimmed = line.replace(/^[a-f0-9]+\s+/, '').trim();
    if (!trimmed || trimmed.startsWith('chore(release):')) continue;

    if (/^feat(\(.*?\))?:/i.test(trimmed)) {
      categories.Added.push(trimmed.replace(/^feat(\(.*?\))?:\s*/i, ''));
    } else if (/^fix(\(.*?\))?:/i.test(trimmed)) {
      categories.Fixed.push(trimmed.replace(/^fix(\(.*?\))?:\s*/i, ''));
    } else if (/^sec(urity)?(\(.*?\))?:/i.test(trimmed)) {
      categories.Security.push(trimmed.replace(/^sec(urity)?(\(.*?\))?:\s*/i, ''));
    } else if (/^(perf|refactor|change)(\(.*?\))?:/i.test(trimmed)) {
      categories.Changed.push(trimmed.replace(/^(perf|refactor|change)(\(.*?\))?:\s*/i, ''));
    } else {
      categories.Changed.push(trimmed);
    }
  }

  return categories;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const targetType = args.find((a) => !a.startsWith('--'));

  console.log('🚀 Démarrage de la release semi-automatique pour vote-cdm\n');

  // 1. Vérification de Git
  try {
    const status = run('git status --porcelain', { silent: true });
    const trackedChanges = status
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('??'));

    if (trackedChanges.length > 0) {
      console.error('❌ Erreur : Des modifications suivies ne sont pas commitées.');
      console.error('Veuillez commiter ou remiser (stash) vos modifications avant de lancer une release :\n');
      console.error(trackedChanges.join('\n'));
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Erreur lors de la vérification git status :', err.message);
    process.exit(1);
  }

  const currentBranch = run('git rev-parse --abbrev-ref HEAD', { silent: true });
  console.log(`🌿 Branche courante : ${currentBranch}`);

  // 2. Détermination de la version actuelle et du dernier tag
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  const currentVersion = pkg.version;
  const { major, minor, patch } = parseSemver(currentVersion);

  let lastTag = null;
  try {
    lastTag = run('git describe --tags --abbrev=0', { silent: true });
  } catch {
    lastTag = `v${currentVersion}`;
  }

  console.log(`📦 Version actuelle : ${currentVersion} (dernier tag : ${lastTag})`);

  // 3. Analyse des commits récents
  let commits = [];
  try {
    const rawCommits = run(`git log ${lastTag}..HEAD --oneline`, { silent: true });
    commits = rawCommits ? rawCommits.split('\n').filter(Boolean) : [];
  } catch {
    commits = [];
  }

  console.log(`📝 ${commits.length} commit(s) trouvé(s) depuis ${lastTag}.`);

  // Détection du type suggéré
  let suggested = 'patch';
  const hasBreaking = commits.some((c) => /BREAKING CHANGE|!:/i.test(c));
  const hasFeat = commits.some((c) => /^feat(\(.*?\))?:/i.test(c.replace(/^[a-f0-9]+\s+/, '')));

  if (hasBreaking) suggested = 'major';
  else if (hasFeat) suggested = 'minor';

  const patchVersion = `${major}.${minor}.${patch + 1}`;
  const minorVersion = `${major}.${minor + 1}.0`;
  const majorVersion = `${major + 1}.0.0`;

  let newVersion = null;
  const rl = readline.createInterface({ input, output });

  if (targetType) {
    if (targetType === 'patch') newVersion = patchVersion;
    else if (targetType === 'minor') newVersion = minorVersion;
    else if (targetType === 'major') newVersion = majorVersion;
    else if (/^\d+\.\d+\.\d+$/.test(targetType)) newVersion = targetType;
    else {
      console.error(`❌ Type de version inconnu : ${targetType}`);
      rl.close();
      process.exit(1);
    }
  } else {
    console.log('\nChoisissez le type de release :');
    console.log(`  1) patch -> ${patchVersion}${suggested === 'patch' ? ' (recommandé)' : ''}`);
    console.log(`  2) minor -> ${minorVersion}${suggested === 'minor' ? ' (recommandé)' : ''}`);
    console.log(`  3) major -> ${majorVersion}${suggested === 'major' ? ' (recommandé)' : ''}`);
    console.log('  4) Saisie manuelle');

    const defaultChoice = suggested === 'major' ? '3' : suggested === 'minor' ? '2' : '1';
    const choice = (await rl.question(`\nVotre choix [1/2/3/4] (défaut: ${defaultChoice}) : `)).trim() || defaultChoice;

    if (choice === '1') newVersion = patchVersion;
    else if (choice === '2') newVersion = minorVersion;
    else if (choice === '3') newVersion = majorVersion;
    else if (choice === '4') {
      const custom = (await rl.question('Entrez le numéro de version (ex: 1.2.0) : ')).trim();
      parseSemver(custom);
      newVersion = custom;
    } else {
      console.error('❌ Choix invalide.');
      rl.close();
      process.exit(1);
    }
  }

  const nextTag = `v${newVersion}`;
  console.log(`\n🎯 Version cible : ${newVersion} (Tag : ${nextTag})`);

  // 4. Préparation du CHANGELOG
  const today = new Date().toISOString().slice(0, 10);
  const repoUrl = getRepoUrl();
  let changelogContent = fs.readFileSync(CHANGELOG_PATH, 'utf8');

  // Extraction de la section Unreleased
  const unreleasedRegex = /## \[Unreleased\]([\s\S]*?)(## \[\d+\.\d+\.\d+\])/;
  const match = changelogContent.match(unreleasedRegex);

  let newReleaseSection = '';
  if (match) {
    const existingNotes = match[1].trim();
    if (existingNotes.length > 0) {
      newReleaseSection = `\n\n${existingNotes}\n`;
    } else if (commits.length > 0) {
      const categories = categorizeCommits(commits);
      let built = '';
      for (const [cat, items] of Object.entries(categories)) {
        if (items.length > 0) {
          built += `\n### ${cat}\n${items.map((i) => `- ${i}`).join('\n')}\n`;
        }
      }
      newReleaseSection = built ? `\n${built}` : '\n\n### Changed\n- Mises à jour diverses.\n';
    } else {
      newReleaseSection = '\n\n### Changed\n- Mises à jour diverses.\n';
    }
  } else {
    newReleaseSection = '\n\n### Changed\n- Mises à jour diverses.\n';
  }

  // Remplacement de Unreleased
  const replacement = `## [Unreleased]\n\n## [${newVersion}] - ${today}${newReleaseSection}\n$2`;
  let updatedChangelog = changelogContent.replace(unreleasedRegex, replacement);

  // Mise à jour des liens en bas
  const prevVersion = lastTag.replace(/^v/, '');
  const unreleasedLinkRegex = /\[Unreleased\]: .*/;
  const newUnreleasedLink = `[Unreleased]: ${repoUrl}/compare/${nextTag}...HEAD`;
  const newVersionLink = `[${newVersion}]: ${repoUrl}/compare/${lastTag}...${nextTag}`;

  if (updatedChangelog.match(unreleasedLinkRegex)) {
    updatedChangelog = updatedChangelog.replace(
      unreleasedLinkRegex,
      `${newUnreleasedLink}\n${newVersionLink}`
    );
  } else {
    updatedChangelog += `\n${newUnreleasedLink}\n${newVersionLink}\n`;
  }

  console.log('\n📄 Aperçu du CHANGELOG mis à jour :');
  console.log('----------------------------------------');
  console.log(`## [${newVersion}] - ${today}${newReleaseSection.trimEnd()}`);
  console.log('----------------------------------------');

  const confirm = (await rl.question(`\nConfirmer la release ${newVersion} ? (O/n) : `)).trim().toLowerCase();
  if (confirm && confirm !== 'o' && confirm !== 'oui' && confirm !== 'y' && confirm !== 'yes') {
    console.log('🚫 Release annulée.');
    rl.close();
    process.exit(0);
  }

  if (isDryRun) {
    console.log('\n🔍 Mode --dry-run actif : aucune modification n’a été enregistrée.');
    rl.close();
    process.exit(0);
  }

  // 5. Application des modifications
  console.log('\n✍️ Mise à jour du CHANGELOG.md...');
  fs.writeFileSync(CHANGELOG_PATH, updatedChangelog, 'utf8');

  console.log('✍️ Mise à jour de package.json et package-lock.json...');
  run(`npm version ${newVersion} --no-git-tag-version`);

  // 6. Commit et Tag Git
  console.log('📦 Création du commit Git...');
  run('git add package.json package-lock.json CHANGELOG.md');
  run(`git commit -m "chore(release): v${newVersion}"`);

  console.log(`🏷️ Création du tag ${nextTag}...`);
  run(`git tag -a ${nextTag} -m "Release v${newVersion}"`);

  console.log(`\n🎉 Release v${newVersion} créée avec succès !`);

  // 7. Proposition de push
  const shouldPush = (
    await rl.question(`\nVoulez-vous pousser la branche '${currentBranch}' et les tags sur GitHub ? (O/n) : `)
  )
    .trim()
    .toLowerCase();

  rl.close();

  if (!shouldPush || shouldPush === 'o' || shouldPush === 'oui' || shouldPush === 'y' || shouldPush === 'yes') {
    console.log('\n🚀 Envoi vers GitHub...');
    try {
      run(`git push origin ${currentBranch}`);
      run('git push origin --tags');
      console.log('✅ Déploiement Git terminé avec succès !');
    } catch (err) {
      console.error('⚠️ Le push a échoué. Vous pouvez exécuter manuellement :');
      console.error(`git push origin ${currentBranch} && git push origin --tags`);
    }
  } else {
    console.log('\n💡 Pour pousser manuellement plus tard :');
    console.log(`git push origin ${currentBranch} && git push origin --tags`);
  }
}

main().catch((err) => {
  console.error('\n❌ Erreur inattendue :', err);
  process.exit(1);
});
