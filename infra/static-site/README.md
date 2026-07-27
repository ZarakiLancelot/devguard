# DevGuard static site infrastructure

CloudFormation defines a private S3 REST origin, S3 Block Public Access, BucketOwnerEnforced ownership, S3-managed encryption, a CloudFront Origin Access Control that signs with SigV4, and a CloudFront distribution using the default certificate and `PriceClass_100`. S3 website hosting is intentionally disabled; CloudFront is the public HTTPS edge.

Prerequisites: AWS CLI v2, an active SSO session for profile `devguard`, and region `us-east-1`. No credentials are stored in this repository.

```sh
aws sso login --profile devguard
./scripts/deploy-static-site.sh
./scripts/destroy-static-site.sh
```

The deploy script validates the template, deploys the stack, uploads only `site/` contents, assigns cache headers, and invalidates CloudFront. The destroy script requires confirmation, obtains the bucket from stack outputs, empties it, and deletes the stack; CloudFormation cannot delete a nonempty bucket. S3 and CloudFront are usage-based services. A custom domain is out of scope.
