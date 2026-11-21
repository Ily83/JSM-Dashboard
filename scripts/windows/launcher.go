// Portable console launcher; the operator only needs the extracted folder.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func run() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Dir(exe)
	cmd := exec.Command(filepath.Join(root, "runtime", "node.exe"), "server.cjs", "--production", "--portable")
	cmd.Dir = root // .env, customer mapping files and dist/ are relative to the app
	cmd.Env = append(cmd.Environ(), "HOST=127.0.0.1")
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	fmt.Println("Jira Operations - Alert Center. Keep this window open; close it to stop the dashboard.")
	return cmd.Run()
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Alert Center stopped:", err)
		fmt.Println("Press Enter to close.")
		fmt.Scanln()
		os.Exit(1)
	}
}
