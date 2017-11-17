# What is this?

This project provides a log forwarder for CloudWatch Logs to SumoLogic. 
It is based on the official log forwarder and adds auto-configuration for all CloudWatch log groups. 

# How to use?

clone the repository and run `deploy.sh <url> <region>`:

* `url` is the URL of the hosted collector in SumoLogic
* `region` is the AWS region to use

Repeat this for every region you want the forwarder to be active

# Changelog

## 1.0.0
* initial commit