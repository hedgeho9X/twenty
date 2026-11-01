FROM scratch
COPY minio /minio
COPY LICENSE /licenses/minio.txt
ENV HOME=/tmp
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
