//! Language server table. Settings overrides (`"lsp": { "<id>": {command,args} | false }`) are applied by the caller.

#[derive(Debug, PartialEq, Eq)]
pub struct ServerSpec {
    pub language: &'static str,
    pub command: &'static str,
    pub args: &'static [&'static str],
    pub install: &'static str,
}

const TS_INSTALL: &str = "npm i -g typescript-language-server typescript";
const VSC_INSTALL: &str = "npm i -g vscode-langservers-extracted";
const STDIO: &[&str] = &["--stdio"];

const fn s(language: &'static str, command: &'static str, args: &'static [&'static str], install: &'static str) -> ServerSpec {
    ServerSpec { language, command, args, install }
}

static TABLE: &[ServerSpec] = &[
    s("typescript", "typescript-language-server", STDIO, TS_INSTALL),
    s("typescriptreact", "typescript-language-server", STDIO, TS_INSTALL),
    s("javascript", "typescript-language-server", STDIO, TS_INSTALL),
    s("javascriptreact", "typescript-language-server", STDIO, TS_INSTALL),
    s("html", "vscode-html-language-server", STDIO, VSC_INSTALL),
    s("css", "vscode-css-language-server", STDIO, VSC_INSTALL),
    s("scss", "vscode-css-language-server", STDIO, VSC_INSTALL),
    s("less", "vscode-css-language-server", STDIO, VSC_INSTALL),
    s("json", "vscode-json-language-server", STDIO, VSC_INSTALL),
    s("jsonc", "vscode-json-language-server", STDIO, VSC_INSTALL),
    s("python", "pyright-langserver", STDIO, "npm i -g pyright"),
    s("rust", "rust-analyzer", &[], "rustup component add rust-analyzer"),
    s("go", "gopls", &[], "go install golang.org/x/tools/gopls@latest"),
    s("c", "clangd", &[], "winget install LLVM.LLVM"),
    s("cpp", "clangd", &[], "winget install LLVM.LLVM"),
    s("java", "jdtls", &[], "scoop install jdtls"),
];

pub fn spec_for(language_id: &str) -> Option<&'static ServerSpec> {
    TABLE.iter().find(|x| x.language == language_id)
}

/// Languages sharing a server share this key (the command), e.g. ts + js.
pub fn server_key(language_id: &str) -> Option<&'static str> {
    spec_for(language_id).map(|x| x.command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_table_ts_js_share_server() {
        let ids = ["typescript", "typescriptreact", "javascript", "javascriptreact"];
        for id in ids {
            let s = spec_for(id).unwrap();
            assert_eq!(s.command, "typescript-language-server");
            assert_eq!(s.args, &["--stdio"]);
            assert_eq!(s.install, "npm i -g typescript-language-server typescript");
            assert_eq!(server_key(id), Some("typescript-language-server"));
        }
    }

    #[test]
    fn spec_table_exact() {
        let rows: &[(&str, &str, &[&str], &str)] = &[
            ("html", "vscode-html-language-server", &["--stdio"], "npm i -g vscode-langservers-extracted"),
            ("css", "vscode-css-language-server", &["--stdio"], "npm i -g vscode-langservers-extracted"),
            ("scss", "vscode-css-language-server", &["--stdio"], "npm i -g vscode-langservers-extracted"),
            ("less", "vscode-css-language-server", &["--stdio"], "npm i -g vscode-langservers-extracted"),
            ("json", "vscode-json-language-server", &["--stdio"], "npm i -g vscode-langservers-extracted"),
            ("jsonc", "vscode-json-language-server", &["--stdio"], "npm i -g vscode-langservers-extracted"),
            ("python", "pyright-langserver", &["--stdio"], "npm i -g pyright"),
            ("rust", "rust-analyzer", &[], "rustup component add rust-analyzer"),
            ("go", "gopls", &[], "go install golang.org/x/tools/gopls@latest"),
            ("c", "clangd", &[], "winget install LLVM.LLVM"),
            ("cpp", "clangd", &[], "winget install LLVM.LLVM"),
            ("java", "jdtls", &[], "scoop install jdtls"),
        ];
        for (id, cmd, args, install) in rows {
            let s = spec_for(id).unwrap_or_else(|| panic!("missing {id}"));
            assert_eq!((s.command, s.args, s.install), (*cmd, *args, *install), "{id}");
            assert_eq!(s.language, *id);
        }
        assert_eq!(server_key("c"), server_key("cpp"));
        assert_ne!(server_key("html"), server_key("css"));
    }

    #[test]
    fn spec_unknown_none() {
        assert!(spec_for("brainfuck").is_none());
        assert!(spec_for("").is_none());
        assert!(server_key("plaintext").is_none());
    }
}
