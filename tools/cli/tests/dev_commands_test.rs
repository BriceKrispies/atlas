use assert_cmd::Command;

#[test]
fn test_dev_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("dev").arg("--help");
    cmd.assert().success();
}

#[test]
fn test_dev_up_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("dev").arg("up").arg("--help");
    cmd.assert().success();
}

#[test]
fn test_dev_seed_control_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("dev").arg("seed-control").arg("--help");
    cmd.assert().success();
}

#[test]
fn test_dev_tenant_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("dev").arg("tenant").arg("--help");
    cmd.assert().success();
}

#[test]
fn test_dev_tenant_create_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("dev").arg("tenant").arg("create").arg("--help");
    cmd.assert().success();
}

#[test]
fn test_dev_tenant_delete_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("dev").arg("tenant").arg("delete").arg("--help");
    cmd.assert().success();
}

#[test]
fn test_dev_reset_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("dev").arg("reset").arg("--help");
    cmd.assert().success();
}

#[test]
fn test_dev_quickstart_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("dev").arg("quickstart").arg("--help");
    cmd.assert().success();
}

#[test]
fn test_dev_status_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("dev").arg("status").arg("--help");
    cmd.assert().success();
}
