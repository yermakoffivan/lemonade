#include <lemon/cli_parser.h>
#include <lemon/utils/path_utils.h>
#include <lemon/version.h>

#define APP_NAME "lemond"
#define APP_DESC APP_NAME " - Lightweight LLM server"

namespace lemon {

CLIParser::CLIParser()
    : app_(APP_DESC) {

    app_.set_version_flag("-v,--version", (APP_NAME " version " LEMON_VERSION_STRING));

    // Positional arg: lemonade cache/data directory (optional)
    // Default to the platform-specific cache dir when not specified
    cache_dir_opt_ = app_.add_option("cache_dir", config_.cache_dir,
                    "Lemonade cache directory for downloaded/runtime data")
        ->type_name("DIR")
        ->default_val(utils::get_cache_dir());

    config_dir_opt_ = app_.add_option("config_dir", config_.config_dir,
                    "Lemonade config directory for persistent JSON state")
        ->type_name("DIR")
        ->default_val(utils::get_config_dir());

    app_.add_option("--port", config_.port, "Port number to serve on (overrides config.json)")
        ->type_name("PORT");

    app_.add_option("--host", config_.host, "Address to bind for connections (overrides config.json)")
        ->type_name("HOST");
}

int CLIParser::parse(int argc, char** argv) {
    try {
        app_.parse(argc, argv);
        // When a custom cache dir is given without an explicit config dir, keep
        // persistent JSON state alongside it instead of splitting it off to the
        // platform config default. Only the standard (defaulted) cache layout is
        // remapped to the config directory.
        if (cache_dir_opt_->count() > 0 && config_dir_opt_->count() == 0) {
            config_.config_dir = config_.cache_dir;
        }
        should_continue_ = true;
        exit_code_ = 0;
        return 0;  // Success, continue
    } catch (const CLI::ParseError& e) {
        // Help/version requested or parse error occurred
        // Let CLI11 handle printing and get the exit code
        exit_code_ = app_.exit(e);
        should_continue_ = false;  // Don't continue, just exit
        return exit_code_;
    }
}

} // namespace lemon
