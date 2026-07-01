const { existsSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

function resolveJavaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Android\\Android Studio\\jbr',
      'C:\\Program Files\\Android\\Android Studio\\jre',
      'C:\\Program Files\\Java\\jdk-21',
      'C:\\Program Files\\Java\\jdk-17'
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function run() {
  const projectRoot = join(__dirname, '..');
  const javaHome = resolveJavaHome();
  const env = { ...process.env };

  if (javaHome) {
    env.JAVA_HOME = javaHome;
    const javaBin = join(javaHome, 'bin');
    env.Path = process.platform === 'win32'
      ? `${javaBin};${env.Path || ''}`
      : env.PATH;
    env.PATH = process.platform === 'win32'
      ? env.Path
      : `${javaBin}:${env.PATH || ''}`;

    console.log(`Usando JAVA_HOME: ${javaHome}`);
  } else {
    console.log('JAVA_HOME nao detectado automaticamente; usando ambiente atual.');
  }

  const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const result = spawnSync(gradleCmd, ['assembleDebug', '--no-daemon'], {
    cwd: join(projectRoot, 'android'),
    stdio: 'inherit',
    env,
    shell: false
  });

  process.exit(result.status || 0);
}

run();
