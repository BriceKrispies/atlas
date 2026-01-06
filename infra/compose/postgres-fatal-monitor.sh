#\!/bin/sh
# Monitor PostgreSQL logs and exit container on FATAL errors

/usr/local/bin/docker-entrypoint.sh postgres 2>&1 | while IFS= read -r line; do
    echo "$line"
    if echo "$line" | grep -q "FATAL:"; then
        echo "FATAL error detected - exiting container"
        killall postgres
        exit 1
    fi
done

exit $?
