FROM eclipse-mosquitto:2.0

COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY acl_file /mosquitto/config/acl_file

# Create password file with hashed passwords during build
# Change these credentials before deploying!
RUN mosquitto_passwd -c -b /mosquitto/config/password_file bridge SmokeSense_Bridge_2026! && \
    mosquitto_passwd -b /mosquitto/config/password_file dataguard DG_Device_Secret_2026! && \
    mosquitto_passwd -b /mosquitto/config/password_file node SS_Node_Secret_2026! && \
    mosquitto_passwd -b /mosquitto/config/password_file gateway GW_Gateway_Secret_2026! && \
    mosquitto_passwd -b /mosquitto/config/password_file admin Arctic_Admin_2026!

RUN mkdir -p /mosquitto/data && chown -R mosquitto:mosquitto /mosquitto

EXPOSE 1883 9001

USER mosquitto
CMD ["mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]
