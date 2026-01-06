use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

struct TestEnv {
    _temp_dir: TempDir,
    path: PathBuf,
}

fn setup_test_env() -> TestEnv {
    let temp_dir = TempDir::new().unwrap();
    let path = temp_dir.path().to_path_buf();

    fs::create_dir_all(path.join("apps")).unwrap();
    fs::create_dir_all(path.join("infra").join("k8s").join("services")).unwrap();
    fs::create_dir_all(path.join("infra").join("kafka")).unwrap();

    TestEnv {
        _temp_dir: temp_dir,
        path,
    }
}

#[test]
fn test_cli_version() {
    Command::cargo_bin("atlas")
        .unwrap()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("atlas"));
}

#[test]
fn test_scaffold_dry_run() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["scaffold", "test-service", "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("DRY RUN"))
        .stdout(predicate::str::contains("test-service"));

    assert!(!env.path.join("apps").join("test-service").exists());
}

#[test]
fn test_scaffold_creates_service() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["scaffold", "my-api", "-t", "api", "-l", "rust"])
        .assert()
        .success()
        .stdout(predicate::str::contains("scaffolded successfully"));

    assert!(env.path.join("apps").join("my-api").exists());
    assert!(env.path.join("apps").join("my-api").join("service.yaml").exists());
    assert!(env.path.join("apps").join("my-api").join("Cargo.toml").exists());
    assert!(env.path.join("apps").join("my-api").join("src").join("main.rs").exists());
    assert!(env.path.join("apps").join("my-api").join("run.sh").exists());
}

#[test]
fn test_scaffold_worker_service() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["scaffold", "my-worker", "-t", "worker", "-l", "rust"])
        .assert()
        .success();

    let manifest_content = fs::read_to_string(env.path.join("apps").join("my-worker").join("service.yaml")).unwrap();
    assert!(manifest_content.contains("name: my-worker"));
    assert!(manifest_content.contains("type: worker"));
    assert!(manifest_content.contains("language: rust"));
}

#[test]
fn test_validate_no_services() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["validate"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No service manifests found"));
}

#[test]
fn test_validate_with_service() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["scaffold", "valid-service"])
        .assert()
        .success();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["validate"])
        .assert()
        .success()
        .stdout(predicate::str::contains("All validations passed"));
}

#[test]
fn test_validate_json_output() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["scaffold", "json-service"])
        .assert()
        .success();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["validate", "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"valid\""));
}

#[test]
fn test_gen_creates_k8s_manifest() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["scaffold", "gen-test"])
        .assert()
        .success();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["gen"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Generated infrastructure"));

    assert!(env.path.join("infra").join("k8s").join("services").join("gen-test.yaml").exists());
}

#[test]
fn test_gen_dry_run() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["scaffold", "dry-gen-test"])
        .assert()
        .success();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["gen", "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("DRY RUN"))
        .stdout(predicate::str::contains("Would write"));
}

#[test]
fn test_validate_detects_name_mismatch() {
    let env = setup_test_env();

    fs::create_dir_all(env.path.join("apps").join("wrong-dir")).unwrap();
    fs::write(
        env.path.join("apps").join("wrong-dir").join("service.yaml"),
        "name: correct-name\ntype: api\nlanguage: rust\n",
    )
    .unwrap();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["validate"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("does not match directory name"));
}

#[test]
fn test_gen_idempotent() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["scaffold", "idempotent-test"])
        .assert()
        .success();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["gen"])
        .assert()
        .success();

    let first_gen = fs::read_to_string(env.path.join("infra").join("k8s").join("services").join("idempotent-test.yaml")).unwrap();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["gen"])
        .assert()
        .success();

    let second_gen = fs::read_to_string(env.path.join("infra").join("k8s").join("services").join("idempotent-test.yaml")).unwrap();

    assert_eq!(first_gen, second_gen, "Gen should be idempotent");
}

#[test]
fn test_validate_drift_detection() {
    let env = setup_test_env();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["scaffold", "drift-test"])
        .assert()
        .success();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["gen"])
        .assert()
        .success();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["validate", "--check-drift"])
        .assert()
        .success()
        .stdout(predicate::str::contains("All validations passed"));

    fs::write(env.path.join("infra").join("k8s").join("services").join("drift-test.yaml"), "modified content").unwrap();

    Command::cargo_bin("atlas")
        .unwrap()
        .current_dir(&env.path)
        .args(&["validate", "--check-drift"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("Drift detected"));
}

#[test]
fn test_scaffold_with_different_languages() {
    let env = setup_test_env();

    let languages = vec![
        ("typescript", "package.json", "src/index.js"),
        ("python", "requirements.txt", "main.py"),
        ("go", "go.mod", "main.go"),
    ];

    for (lang, file1, file2) in languages {
        let service_name = format!("{}-service", lang);
        Command::cargo_bin("atlas")
            .unwrap()
            .current_dir(&env.path)
            .args(&["scaffold", &service_name, "-l", lang])
            .assert()
            .success();

        assert!(
            env.path.join("apps").join(&service_name).join(file1).exists(),
            "Missing {} for {}",
            file1,
            lang
        );
        assert!(
            env.path.join("apps").join(&service_name).join(file2).exists(),
            "Missing {} for {}",
            file2,
            lang
        );
    }
}
