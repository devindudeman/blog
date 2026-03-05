{ pkgs, ... }:
{
  packages = [
    pkgs.ruby_3_4
    pkgs.bundler
    pkgs.libyaml
    pkgs.gnumake
  ];

  env = {
    BUNDLE_PATH = ".bundle";
    BUNDLE_JOBS = "4";
    BUNDLE_RETRY = "3";
  };

  enterShell = ''
    echo "Ruby: $(ruby --version)"
    echo "Bundler: $(bundle --version)"
    echo "Use 'devenv run setup' once, then 'devenv run serve'."
  '';

  scripts.setup.exec = "bundle install";
  scripts.serve.exec = "bundle exec jekyll serve --livereload --host 0.0.0.0 --port 4000";
  scripts.build.exec = "bundle exec jekyll build";
  scripts.clean.exec = "bundle exec jekyll clean";
}
