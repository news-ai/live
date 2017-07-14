# Notification

Websocket server to help sync API data to Tabulae.

### Authentication

```
{
    "userId": "4000",
    "accessToken": "a1b2c3",
    "teamId": "4000",
    "page": "https://tabulae.newsai.co/"
}
```

### Notifications

Email notification

```
{
    "resouceName": "email",
    "resourceId": "4000",
    "resourceAction": "open"
    "userId": "4000",
}
```

### Change schema

Contact change

```
{
    "resourceName": "contact",
    "resourceId": "4000",
    "change": "{json string}",
    "page": "https://tabulae.newsai.co/tables/5326642465472512"
}
```

List change

```
{
    "resourceName": "list",
    "resourceId": "4000",
    "change": "{json string}",
    "page": "https://tabulae.newsai.co/tables/5326642465472512"
}
```

Page change

```
{
    "resourceName": "page",
    "page": "https://tabulae.newsai.co/tables/5326642465472512",
    "userId": "5749563331706880",
    "teamId": "5178017471004672"
}
```
