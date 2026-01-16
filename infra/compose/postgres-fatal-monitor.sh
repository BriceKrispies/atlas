#\!/bin/sh
# Monitor PostgreSQL logs and exit container on FATAL errors

/usr/local/bin/docker-entrypoint.sh postgres 2>&1 | while IFS= read -r line; do
    echo "$line"
    if echo "$line" | grep -q "FATAL:"; then
        # Ignore expected FATAL messages during startup/recovery
        if echo "$line" | grep -q "the database system is starting up"; then
            continue
        fi
        if echo "$line" | grep -q "the database system is shutting down"; then
            continue
        fi
        echo "FATAL error detected - exiting container"
        killall postgres
        exit 1
    fi
done

exit $?
