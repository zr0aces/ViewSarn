// src/config.js reads every environment variable once, at require time, so a
// test that needs different config must bust the cache for config *and* every
// module that captured a value from it.
function loadFreshModules(env, modulePaths) {
    const previous = {};
    for (const key of [...Object.keys(env), 'LOG_LEVEL']) previous[key] = process.env[key];

    Object.assign(process.env, env);
    process.env.LOG_LEVEL = 'silent';

    const paths = ['../src/config', '../src/logger', ...modulePaths];
    for (const mod of paths) delete require.cache[require.resolve(mod)];

    const loaded = modulePaths.map(mod => require(mod));

    for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }

    return loaded.length === 1 ? loaded[0] : loaded;
}

module.exports = { loadFreshModules };
